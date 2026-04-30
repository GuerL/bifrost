import {
    createMultipartFileField,
    createMultipartTextField,
} from "../../helpers/requestBodyUtils.ts";
import type { KeyValue, Request } from "../../types.ts";
import { buildSchemaExample } from "./schemaExampleBuilder.ts";
import type {
    JsonObject,
    OpenApiGeneratedRequest,
    OpenApiGroupingStrategy,
    OpenApiImportPlan,
    OpenApiParsedSpec,
} from "./openApiTypes.ts";

const SUPPORTED_METHODS: Array<{ key: string; method: Request["method"]; label: string }> = [
    { key: "get", method: "get", label: "GET" },
    { key: "post", method: "post", label: "POST" },
    { key: "put", method: "put", label: "PUT" },
    { key: "patch", method: "patch", label: "PATCH" },
    { key: "delete", method: "delete", label: "DELETE" },
    { key: "head", method: "head", label: "HEAD" },
    { key: "options", method: "options", label: "OPTIONS" },
];

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function decodeJsonPointerSegment(segment: string): string {
    return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

class RefResolver {
    private readonly seenMissingRefs = new Set<string>();
    private readonly seenExternalRefs = new Set<string>();

    constructor(
        private readonly root: JsonObject,
        private readonly addWarning: (message: string) => void
    ) {}

    resolve(ref: string): unknown | null {
        if (!ref.startsWith("#/")) {
            if (!this.seenExternalRefs.has(ref)) {
                this.seenExternalRefs.add(ref);
                this.addWarning(`External reference skipped: ${ref}`);
            }
            return null;
        }

        const segments = ref
            .slice(2)
            .split("/")
            .map((segment) => decodeJsonPointerSegment(segment));

        let cursor: unknown = this.root;
        for (const segment of segments) {
            if (!isObject(cursor) && !Array.isArray(cursor)) {
                cursor = undefined;
                break;
            }

            if (Array.isArray(cursor)) {
                const index = Number.parseInt(segment, 10);
                if (!Number.isFinite(index)) {
                    cursor = undefined;
                    break;
                }
                cursor = cursor[index];
                continue;
            }

            cursor = cursor[segment];
        }

        if (cursor === undefined) {
            if (!this.seenMissingRefs.has(ref)) {
                this.seenMissingRefs.add(ref);
                this.addWarning(`Reference not found: ${ref}`);
            }
            return null;
        }

        return cursor;
    }

    resolveObjectRef(input: unknown): JsonObject | null {
        let current: unknown = input;
        const visited = new Set<string>();

        for (let depth = 0; depth < 24; depth += 1) {
            if (!isObject(current)) return null;
            const ref = asString(current.$ref);
            if (!ref) return current;
            if (visited.has(ref)) {
                this.addWarning(`Circular reference skipped: ${ref}`);
                return null;
            }
            visited.add(ref);
            current = this.resolve(ref);
            if (!current) return null;
        }

        this.addWarning("Reference depth exceeded while resolving schema.");
        return null;
    }
}

function toPlaceholderTemplate(value: string): string {
    return value.replace(/\{([^{}]+)\}/g, (_match, variable) => `{{${String(variable).trim()}}}`);
}

function firstPathSegment(path: string): string | null {
    const cleaned = path.trim().replace(/^\/+/, "");
    if (!cleaned) return null;
    const segment = cleaned.split("/")[0]?.trim() ?? "";
    if (!segment || segment.startsWith("{")) return null;
    return segment;
}

function mergeUrl(baseUrl: string | null, path: string): string {
    const normalizedPath = toPlaceholderTemplate(path);
    if (!baseUrl || baseUrl === "/") {
        return normalizedPath || "/";
    }

    const cleanedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const cleanedPath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
    return `${cleanedBase}${cleanedPath}`;
}

function valueToString(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return "";
    }
}

function pickFirstExampleValue(examples: unknown, resolver: RefResolver): unknown {
    if (Array.isArray(examples)) {
        return examples.find((entry) => entry !== undefined);
    }
    if (!isObject(examples)) return undefined;

    for (const value of Object.values(examples)) {
        const resolved = resolver.resolveObjectRef(value) ?? (isObject(value) ? value : null);
        if (resolved && "value" in resolved) {
            return resolved.value;
        }
        if (value !== undefined) {
            return value;
        }
    }
    return undefined;
}

function inferFromSchema(schemaInput: unknown, resolver: RefResolver): unknown {
    return buildSchemaExample(schemaInput, {
        resolveRef: (ref) => resolver.resolve(ref),
        maxDepth: 6,
    });
}

function parameterExample(parameter: JsonObject, resolver: RefResolver): unknown {
    if (parameter.example !== undefined) return parameter.example;
    const examplesCandidate = pickFirstExampleValue(parameter.examples, resolver);
    if (examplesCandidate !== undefined) return examplesCandidate;

    const schema = resolver.resolveObjectRef(parameter.schema) ?? (isObject(parameter.schema) ? parameter.schema : null);
    if (schema) {
        if (schema.example !== undefined) return schema.example;
        if (schema.default !== undefined) return schema.default;
        if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
        return inferFromSchema(schema, resolver);
    }

    if (parameter.default !== undefined) return parameter.default;
    if (Array.isArray(parameter.enum) && parameter.enum.length > 0) return parameter.enum[0];
    if (parameter.example !== undefined) return parameter.example;
    return undefined;
}

function mergeParameters(pathParams: JsonObject[], operationParams: JsonObject[]): JsonObject[] {
    const byKey = new Map<string, JsonObject>();
    for (const entry of pathParams) {
        const name = asString(entry.name);
        const location = asString(entry.in);
        if (!name || !location) continue;
        byKey.set(`${location}:${name}`.toLowerCase(), entry);
    }
    for (const entry of operationParams) {
        const name = asString(entry.name);
        const location = asString(entry.in);
        if (!name || !location) continue;
        byKey.set(`${location}:${name}`.toLowerCase(), entry);
    }
    return Array.from(byKey.values());
}

function extractParameters(input: unknown, resolver: RefResolver): JsonObject[] {
    if (!Array.isArray(input)) return [];
    const out: JsonObject[] = [];
    for (const entry of input) {
        const resolved = resolver.resolveObjectRef(entry);
        if (resolved) out.push(resolved);
    }
    return out;
}

function headerExists(headers: KeyValue[], key: string): boolean {
    const target = key.trim().toLowerCase();
    return headers.some((entry) => entry.key.trim().toLowerCase() === target);
}

function upsertHeader(headers: KeyValue[], key: string, value: string) {
    if (headerExists(headers, key)) return;
    headers.push({ key, value });
}

function upsertQuery(query: KeyValue[], key: string, value: string) {
    if (query.some((entry) => entry.key === key)) return;
    query.push({ key, value });
}

function extractQueryParams(parameters: JsonObject[], resolver: RefResolver): KeyValue[] {
    const out: KeyValue[] = [];
    for (const parameter of parameters) {
        const location = asString(parameter.in)?.toLowerCase();
        if (location !== "query") continue;
        const name = asString(parameter.name);
        if (!name) continue;
        const sample = parameterExample(parameter, resolver);
        out.push({
            key: name,
            value: valueToString(sample),
        });
    }
    return out;
}

function extractHeaderParams(parameters: JsonObject[], resolver: RefResolver): KeyValue[] {
    const out: KeyValue[] = [];
    for (const parameter of parameters) {
        const location = asString(parameter.in)?.toLowerCase();
        if (location !== "header") continue;
        const name = asString(parameter.name);
        if (!name) continue;
        const reserved = name.trim().toLowerCase();
        if (reserved === "content-type" || reserved === "accept" || reserved === "authorization") {
            continue;
        }
        const sample = parameterExample(parameter, resolver);
        out.push({
            key: name,
            value: valueToString(sample),
        });
    }
    return out;
}

function choosePreferredMediaType(content: JsonObject): string | null {
    const mediaTypes = Object.keys(content);
    if (mediaTypes.length === 0) return null;

    const priorities = [
        "application/json",
        "text/plain",
        "application/x-www-form-urlencoded",
        "multipart/form-data",
    ];

    for (const priority of priorities) {
        if (mediaTypes.includes(priority)) {
            return priority;
        }
    }

    return mediaTypes[0] ?? null;
}

function bodyForOpenApi3RequestBody(
    requestBodyInput: unknown,
    resolver: RefResolver
): { body: Request["body"]; contentType: string | null } {
    const requestBody = resolver.resolveObjectRef(requestBodyInput);
    if (!requestBody) {
        return { body: { type: "none" }, contentType: null };
    }

    const content = isObject(requestBody.content) ? requestBody.content : null;
    if (!content) {
        return { body: { type: "none" }, contentType: null };
    }

    const mediaType = choosePreferredMediaType(content);
    if (!mediaType) {
        return { body: { type: "none" }, contentType: null };
    }

    const media = resolver.resolveObjectRef(content[mediaType]) ?? (isObject(content[mediaType]) ? content[mediaType] : null);
    const schema = media ? resolver.resolveObjectRef(media.schema) ?? media.schema : null;
    const mediaExample =
        media?.example !== undefined ? media.example : pickFirstExampleValue(media?.examples, resolver);
    const inferredExample =
        mediaExample !== undefined ? mediaExample : inferFromSchema(schema, resolver);

    if (mediaType === "application/json") {
        const value = inferredExample !== undefined ? inferredExample : {};
        const text = (() => {
            try {
                return JSON.stringify(value, null, 2);
            } catch {
                return "{}";
            }
        })();
        return {
            body: { type: "json", value, text },
            contentType: mediaType,
        };
    }

    if (mediaType === "text/plain") {
        return {
            body: { type: "raw", content_type: "text/plain", text: valueToString(inferredExample) },
            contentType: mediaType,
        };
    }

    if (mediaType === "application/x-www-form-urlencoded") {
        const fields: KeyValue[] = [];
        if (isObject(inferredExample)) {
            for (const [key, value] of Object.entries(inferredExample)) {
                fields.push({ key, value: valueToString(value) });
            }
        } else if (isObject(schema) && isObject(schema.properties)) {
            for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
                const sample = inferFromSchema(propertySchema, resolver);
                fields.push({ key: propertyName, value: valueToString(sample) });
            }
        }

        return {
            body: { type: "form", fields },
            contentType: mediaType,
        };
    }

    if (mediaType === "multipart/form-data") {
        const fields: NonNullable<Extract<Request["body"], { type: "multipart" }>["fields"]> = [];
        const exampleObject = isObject(inferredExample) ? inferredExample : {};

        if (isObject(schema) && isObject(schema.properties)) {
            for (const [propertyName, propertySchemaInput] of Object.entries(schema.properties)) {
                const propertySchema =
                    resolver.resolveObjectRef(propertySchemaInput) ??
                    (isObject(propertySchemaInput) ? propertySchemaInput : null);
                const type = asString(propertySchema?.type)?.toLowerCase();
                const format = asString(propertySchema?.format)?.toLowerCase();
                const exampleValue =
                    exampleObject[propertyName] !== undefined
                        ? exampleObject[propertyName]
                        : inferFromSchema(propertySchemaInput, resolver);

                if (type === "string" && (format === "binary" || format === "base64")) {
                    const fileField = createMultipartFileField(valueToString(exampleValue));
                    fields.push({ ...fileField, name: propertyName });
                } else {
                    const textField = createMultipartTextField();
                    fields.push({
                        ...textField,
                        name: propertyName,
                        value: valueToString(exampleValue),
                    });
                }
            }
        } else if (isObject(exampleObject)) {
            for (const [key, value] of Object.entries(exampleObject)) {
                const textField = createMultipartTextField();
                fields.push({ ...textField, name: key, value: valueToString(value) });
            }
        }

        return {
            body: { type: "multipart", fields },
            contentType: mediaType,
        };
    }

    return {
        body: {
            type: "raw",
            content_type: mediaType,
            text: valueToString(inferredExample),
        },
        contentType: mediaType,
    };
}

function listMediaTypes(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input
        .map((entry) => asString(entry))
        .filter((entry): entry is string => !!entry);
}

function bodyForSwagger2Operation(
    parameters: JsonObject[],
    consumes: string[],
    resolver: RefResolver
): { body: Request["body"]; contentType: string | null } {
    const bodyParameter = parameters.find((parameter) => asString(parameter.in)?.toLowerCase() === "body");
    const formParameters = parameters.filter((parameter) => asString(parameter.in)?.toLowerCase() === "formdata");

    if (formParameters.length > 0) {
        const hasFileParameter = formParameters.some(
            (parameter) => asString(parameter.type)?.toLowerCase() === "file"
        );
        const mediaType =
            consumes.find((type) => type === "multipart/form-data") ??
            (hasFileParameter ? "multipart/form-data" : "application/x-www-form-urlencoded");

        if (mediaType === "multipart/form-data") {
            const fields: NonNullable<Extract<Request["body"], { type: "multipart" }>["fields"]> = [];
            for (const parameter of formParameters) {
                const name = asString(parameter.name);
                if (!name) continue;

                const type = asString(parameter.type)?.toLowerCase();
                const sample = parameterExample(parameter, resolver);
                if (type === "file") {
                    const fileField = createMultipartFileField(valueToString(sample));
                    fields.push({ ...fileField, name });
                } else {
                    const textField = createMultipartTextField();
                    fields.push({ ...textField, name, value: valueToString(sample) });
                }
            }
            return { body: { type: "multipart", fields }, contentType: mediaType };
        }

        const fields = formParameters
            .map((parameter) => {
                const name = asString(parameter.name);
                if (!name) return null;
                const sample = parameterExample(parameter, resolver);
                return { key: name, value: valueToString(sample) };
            })
            .filter((entry): entry is KeyValue => entry !== null);

        return { body: { type: "form", fields }, contentType: mediaType };
    }

    if (!bodyParameter) {
        return { body: { type: "none" }, contentType: null };
    }

    const schema = resolver.resolveObjectRef(bodyParameter.schema) ?? bodyParameter.schema;
    const explicitExample = bodyParameter.example;
    const sample =
        explicitExample !== undefined ? explicitExample : inferFromSchema(schema, resolver);
    const value = sample !== undefined ? sample : {};
    const text = (() => {
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return "{}";
        }
    })();
    const mediaType = consumes[0] ?? "application/json";

    return {
        body: { type: "json", value, text },
        contentType: mediaType,
    };
}

function pickServerUrl(serversInput: unknown): string | null {
    if (!Array.isArray(serversInput)) {
        return null;
    }

    for (const serverInput of serversInput) {
        if (!isObject(serverInput)) continue;
        const rawUrl = asString(serverInput.url);
        if (!rawUrl) continue;

        const variables = isObject(serverInput.variables) ? serverInput.variables : {};
        const withDefaults = rawUrl.replace(/\{([^{}]+)\}/g, (_match, variableNameInput) => {
            const variableName = String(variableNameInput);
            const variableSpec =
                isObject(variables[variableName]) ? (variables[variableName] as JsonObject) : null;
            const defaultValue = asString(variableSpec?.default);
            return defaultValue ?? `{${variableName}}`;
        });
        return toPlaceholderTemplate(withDefaults);
    }

    return null;
}

function serverUrlForSwagger2(document: JsonObject): string | null {
    const host = asString(document.host);
    const basePath = asString(document.basePath) ?? "/";
    const schemes = Array.isArray(document.schemes) ? document.schemes : [];
    const scheme =
        schemes
            .map((entry) => asString(entry))
            .find((entry): entry is string => !!entry) ?? "https";

    if (!host) {
        return basePath;
    }

    const normalizedBasePath = basePath.startsWith("/") ? basePath : `/${basePath}`;
    return `${scheme}://${host}${normalizedBasePath}`;
}

type SecurityHint = { location: "header" | "query"; key: string; value: string };

function securityHintsForScheme(
    scheme: JsonObject,
    specKind: OpenApiParsedSpec["kind"]
): SecurityHint[] {
    if (specKind === "openapi3") {
        const type = asString(scheme.type)?.toLowerCase();
        if (type === "apikey") {
            const location = asString(scheme.in)?.toLowerCase();
            const name = asString(scheme.name);
            if (!name) return [];
            if (location === "header") {
                return [{ location: "header", key: name, value: "{{apiKey}}" }];
            }
            if (location === "query") {
                return [{ location: "query", key: name, value: "{{apiKey}}" }];
            }
            return [];
        }

        if (type === "http") {
            const httpScheme = asString(scheme.scheme)?.toLowerCase();
            if (httpScheme === "bearer") {
                return [{ location: "header", key: "Authorization", value: "Bearer {{token}}" }];
            }
            if (httpScheme === "basic") {
                return [{ location: "header", key: "Authorization", value: "Basic {{credentials}}" }];
            }
            return [];
        }

        if (type === "oauth2" || type === "openidconnect") {
            return [{ location: "header", key: "Authorization", value: "Bearer {{token}}" }];
        }

        return [];
    }

    const type = asString(scheme.type)?.toLowerCase();
    if (type === "apikey") {
        const location = asString(scheme.in)?.toLowerCase();
        const name = asString(scheme.name);
        if (!name) return [];
        if (location === "header") {
            return [{ location: "header", key: name, value: "{{apiKey}}" }];
        }
        if (location === "query") {
            return [{ location: "query", key: name, value: "{{apiKey}}" }];
        }
        return [];
    }

    if (type === "basic") {
        return [{ location: "header", key: "Authorization", value: "Basic {{credentials}}" }];
    }

    if (type === "oauth2") {
        return [{ location: "header", key: "Authorization", value: "Bearer {{token}}" }];
    }

    return [];
}

function extractSecurityHints(
    parsedSpec: OpenApiParsedSpec,
    operation: JsonObject,
    resolver: RefResolver
): SecurityHint[] {
    const root = parsedSpec.document;
    const requirements =
        Array.isArray(operation.security)
            ? operation.security
            : Array.isArray(root.security)
                ? root.security
                : [];

    if (requirements.length === 0) {
        return [];
    }

    if (parsedSpec.kind === "openapi3") {
        const components = isObject(root.components) ? root.components : null;
        const schemes = components && isObject(components.securitySchemes) ? components.securitySchemes : {};

        for (const requirementInput of requirements) {
            if (!isObject(requirementInput)) continue;
            for (const schemeName of Object.keys(requirementInput)) {
                const schemeInput = resolver.resolveObjectRef(schemes[schemeName]) ?? schemes[schemeName];
                if (!isObject(schemeInput)) continue;
                const hints = securityHintsForScheme(schemeInput, parsedSpec.kind);
                if (hints.length > 0) {
                    return hints;
                }
            }
        }
        return [];
    }

    const schemes =
        isObject(root.securityDefinitions) ? root.securityDefinitions : {};
    for (const requirementInput of requirements) {
        if (!isObject(requirementInput)) continue;
        for (const schemeName of Object.keys(requirementInput)) {
            const schemeInput = resolver.resolveObjectRef(schemes[schemeName]) ?? schemes[schemeName];
            if (!isObject(schemeInput)) continue;
            const hints = securityHintsForScheme(schemeInput, parsedSpec.kind);
            if (hints.length > 0) {
                return hints;
            }
        }
    }

    return [];
}

function applySecurityHints(headers: KeyValue[], query: KeyValue[], hints: SecurityHint[]) {
    for (const hint of hints) {
        if (hint.location === "header") {
            upsertHeader(headers, hint.key, hint.value);
            continue;
        }
        upsertQuery(query, hint.key, hint.value);
    }
}

function buildRequestName(methodLabel: string, path: string, operation: JsonObject): string {
    const operationId = asString(operation.operationId);
    if (operationId) return operationId;
    const summary = asString(operation.summary);
    if (summary) return summary;
    return `${methodLabel} ${path}`;
}

type MappedOperation = {
    generated: OpenApiGeneratedRequest;
    hasTag: boolean;
    hasPathGroup: boolean;
};

function detectCollectionName(
    parsedSpec: OpenApiParsedSpec,
    fileName: string
): { title: string; apiVersion: string; collectionName: string } {
    const info = isObject(parsedSpec.document.info) ? parsedSpec.document.info : {};
    const title = asString(info.title) ?? fileName;
    const apiVersion = asString(info.version) ?? "unknown";
    const collectionName = apiVersion ? `${title} (${apiVersion})` : title;
    return { title, apiVersion, collectionName };
}

function chooseGrouping(operations: MappedOperation[]): OpenApiGroupingStrategy {
    const hasTagged = operations.some((operation) => operation.hasTag);
    if (hasTagged) return "tags";
    const hasPathGrouping = operations.some((operation) => operation.hasPathGroup);
    if (hasPathGrouping) return "path_segment";
    return "root";
}

function effectiveFolderName(
    grouping: OpenApiGroupingStrategy,
    tagName: string | null,
    pathFolderName: string | null
): string | null {
    if (grouping === "tags") {
        return tagName ?? pathFolderName;
    }
    if (grouping === "path_segment") {
        return pathFolderName;
    }
    return null;
}

function fileNameWithoutExtension(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return "OpenAPI Collection";
    const normalized = trimmed.replace(/\\/g, "/");
    const lastSegment = normalized.split("/").pop() ?? normalized;
    return lastSegment.replace(/\.(json|yaml|yml)$/i, "").trim() || "OpenAPI Collection";
}

export function mapOpenApiToBifrost(
    parsedSpec: OpenApiParsedSpec,
    sourceFileName: string
): OpenApiImportPlan {
    const warnings = new Set<string>(parsedSpec.warnings);
    const addWarning = (message: string) => warnings.add(message);
    const resolver = new RefResolver(parsedSpec.document, addWarning);
    const paths = isObject(parsedSpec.document.paths) ? parsedSpec.document.paths : {};
    const mappedOperations: MappedOperation[] = [];

    const openApiServerUrl =
        parsedSpec.kind === "openapi3"
            ? pickServerUrl(parsedSpec.document.servers) ?? "/"
            : serverUrlForSwagger2(parsedSpec.document) ?? "/";

    const globalConsumes =
        parsedSpec.kind === "swagger2"
            ? listMediaTypes(parsedSpec.document.consumes)
            : [];
    const globalProduces =
        parsedSpec.kind === "swagger2"
            ? listMediaTypes(parsedSpec.document.produces)
            : [];

    for (const [rawPath, pathItemInput] of Object.entries(paths)) {
        if (!isObject(pathItemInput)) continue;
        const pathItem = pathItemInput;
        const pathParameters = extractParameters(pathItem.parameters, resolver);
        const pathFolderName = firstPathSegment(rawPath);

        for (const methodDef of SUPPORTED_METHODS) {
            const operationInput = pathItem[methodDef.key];
            const operation = resolver.resolveObjectRef(operationInput);
            if (!operation) continue;

            const operationParameters = extractParameters(operation.parameters, resolver);
            const mergedParameters = mergeParameters(pathParameters, operationParameters);

            const headers = extractHeaderParams(mergedParameters, resolver);
            const query = extractQueryParams(mergedParameters, resolver);

            let bodyResult: { body: Request["body"]; contentType: string | null };
            let produces: string[] = [];
            if (parsedSpec.kind === "openapi3") {
                bodyResult = bodyForOpenApi3RequestBody(operation.requestBody, resolver);
                const operationResponses = isObject(operation.responses) ? operation.responses : {};
                const successResponse =
                    resolver.resolveObjectRef(operationResponses["200"]) ??
                    resolver.resolveObjectRef(operationResponses["201"]) ??
                    resolver.resolveObjectRef(operationResponses.default);
                const responseContent =
                    successResponse && isObject(successResponse.content) ? successResponse.content : null;
                produces = responseContent ? Object.keys(responseContent) : [];
            } else {
                const consumes = listMediaTypes(operation.consumes);
                const operationConsumes = consumes.length > 0 ? consumes : globalConsumes;
                bodyResult = bodyForSwagger2Operation(mergedParameters, operationConsumes, resolver);

                const operationProduces = listMediaTypes(operation.produces);
                produces = operationProduces.length > 0 ? operationProduces : globalProduces;
            }

            if (bodyResult.contentType) {
                upsertHeader(headers, "Content-Type", bodyResult.contentType);
            }
            if (produces.length > 0) {
                upsertHeader(headers, "Accept", produces[0]);
            }

            const tags =
                Array.isArray(operation.tags)
                    ? operation.tags
                          .map((entry) => asString(entry))
                          .filter((entry): entry is string => !!entry)
                    : [];
            const primaryTag = tags[0] ?? null;

            const requestBaseUrl =
                parsedSpec.kind === "openapi3"
                    ? pickServerUrl(operation.servers) ??
                      pickServerUrl(pathItem.servers) ??
                      openApiServerUrl
                    : openApiServerUrl;
            const requestUrl = mergeUrl(requestBaseUrl, rawPath);
            const requestName = buildRequestName(methodDef.label, rawPath, operation);

            const securityHints = extractSecurityHints(parsedSpec, operation, resolver);
            applySecurityHints(headers, query, securityHints);

            const request: Request = {
                id: crypto.randomUUID(),
                name: requestName,
                method: methodDef.method,
                url: requestUrl,
                headers,
                query,
                body: bodyResult.body,
                auth: { type: "none" },
                extractors: [],
                scripts: { pre_request: "", post_response: "" },
            };

            mappedOperations.push({
                generated: {
                    request,
                    methodLabel: methodDef.label,
                    originalPath: rawPath,
                    folderName: null,
                },
                hasTag: !!primaryTag,
                hasPathGroup: !!pathFolderName,
            });

            const last = mappedOperations[mappedOperations.length - 1];
            if (!last) continue;
            last.generated.folderName = primaryTag ?? pathFolderName;
        }
    }

    const grouping = chooseGrouping(mappedOperations);

    const requests: OpenApiGeneratedRequest[] = mappedOperations.map((mapped) => ({
        ...mapped.generated,
        folderName: effectiveFolderName(
            grouping,
            mapped.hasTag ? mapped.generated.folderName : null,
            firstPathSegment(mapped.generated.originalPath)
        ),
    }));

    const { title, apiVersion, collectionName } = detectCollectionName(
        parsedSpec,
        fileNameWithoutExtension(sourceFileName)
    );

    return {
        collectionName,
        specKind: parsedSpec.kind,
        specVersion: parsedSpec.version,
        grouping,
        requests,
        warnings: Array.from(warnings),
        preview: {
            title,
            version: apiVersion,
            pathCount: Object.keys(paths).length,
            requestCount: requests.length,
            serverUrl: openApiServerUrl,
        },
    };
}
