import {
    createMultipartFileField,
    createMultipartTextField,
} from "../../helpers/requestBodyUtils.ts";
import type { KeyValue, Request, RequestAuth } from "../../types.ts";
import type {
    InsomniaV5Authentication,
    InsomniaV5CollectionDocument,
    InsomniaV5CollectionItem,
    InsomniaV5GeneratedRequest,
    InsomniaV5ImportPlan,
    JsonObject,
} from "./insomniaV5Types.ts";

const SUPPORTED_METHODS = new Map<string, Request["method"]>([
    ["GET", "get"],
    ["POST", "post"],
    ["PUT", "put"],
    ["PATCH", "patch"],
    ["DELETE", "delete"],
    ["HEAD", "head"],
    ["OPTIONS", "options"],
]);

type ParsedParameter = {
    name: string;
    value: string;
    type: "query" | "path";
};

type ImportContext = {
    folderPath: string[];
    inheritedHeaders: KeyValue[];
    inheritedAuth: InsomniaV5Authentication | null;
};

type ScriptMappingResult = {
    scripts: Request["scripts"];
    importedAny: boolean;
};

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    return value;
}

function asTrimmedString(value: unknown): string | null {
    const raw = asString(value);
    if (raw === null) return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function asBoolean(value: unknown): boolean | null {
    if (typeof value !== "boolean") return null;
    return value;
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

function fileNameWithoutExtension(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return "Insomnia Collection";
    const normalized = trimmed.replace(/\\/g, "/");
    const base = normalized.split("/").pop() ?? normalized;
    const stripped = base.replace(/\.(json|yaml|yml)$/i, "").trim();
    return stripped || "Insomnia Collection";
}

function normalizeMethod(methodInput: unknown): Request["method"] | null {
    const method = asTrimmedString(methodInput);
    if (!method) return null;
    return SUPPORTED_METHODS.get(method.toUpperCase()) ?? null;
}

function headerKey(header: KeyValue): string {
    return header.key.trim().toLowerCase();
}

function mergeHeaders(base: KeyValue[], overrides: KeyValue[]): KeyValue[] {
    const merged = base.map((entry) => ({ ...entry }));
    const indexByKey = new Map<string, number>();
    for (const [index, header] of merged.entries()) {
        indexByKey.set(headerKey(header), index);
    }

    for (const header of overrides) {
        const key = headerKey(header);
        if (!key) continue;
        const existingIndex = indexByKey.get(key);
        if (existingIndex === undefined) {
            indexByKey.set(key, merged.length);
            merged.push({ ...header });
            continue;
        }
        merged[existingIndex] = { ...header };
    }

    return merged;
}

function upsertHeader(headers: KeyValue[], key: string, value: string) {
    const normalized = key.trim().toLowerCase();
    const existingIndex = headers.findIndex((entry) => entry.key.trim().toLowerCase() === normalized);
    if (existingIndex === -1) {
        headers.push({ key, value });
        return;
    }
    headers[existingIndex] = { key, value };
}

function parseHeaders(
    headersInput: unknown,
    location: string,
    addWarning: (message: string) => void,
    detectTemplateSyntax: (value: string) => void
): KeyValue[] {
    if (headersInput === undefined || headersInput === null) {
        return [];
    }
    if (!Array.isArray(headersInput)) {
        addWarning(`Ignored invalid headers at ${location}. Expected an array.`);
        return [];
    }

    const headers: KeyValue[] = [];
    for (const [index, entry] of headersInput.entries()) {
        if (!isObject(entry)) {
            addWarning(`Ignored invalid header at ${location}[${index}].`);
            continue;
        }
        if (asBoolean(entry.disabled) === true) continue;

        const name = asTrimmedString(entry.name);
        if (!name) continue;
        const value = valueToString(entry.value);
        detectTemplateSyntax(value);
        headers.push({ key: name, value });
    }

    return headers;
}

function parseParameters(
    parametersInput: unknown,
    pathParametersInput: unknown,
    location: string,
    addWarning: (message: string) => void,
    detectTemplateSyntax: (value: string) => void
): ParsedParameter[] {
    const parsed: ParsedParameter[] = [];

    const parseEntries = (
        entries: unknown[],
        forcedType: "query" | "path" | null,
        listLocation: string
    ) => {
        for (const [index, rawEntry] of entries.entries()) {
            if (!isObject(rawEntry)) {
                addWarning(`Ignored invalid parameter at ${listLocation}[${index}].`);
                continue;
            }
            if (asBoolean(rawEntry.disabled) === true) continue;

            const name = asTrimmedString(rawEntry.name);
            if (!name) continue;

            const rawType = forcedType ?? asTrimmedString(rawEntry.type)?.toLowerCase() ?? "query";
            if (rawType !== "query" && rawType !== "path") {
                addWarning(`Ignored unsupported parameter type '${rawType}' for '${name}' at ${listLocation}.`);
                continue;
            }

            const value = valueToString(rawEntry.value);
            detectTemplateSyntax(value);
            parsed.push({
                name,
                value,
                type: rawType,
            });
        }
    };

    if (Array.isArray(parametersInput)) {
        parseEntries(parametersInput, null, `${location}.parameters`);
    } else if (parametersInput !== undefined && parametersInput !== null) {
        addWarning(`Ignored invalid parameters at ${location}.parameters. Expected an array.`);
    }

    if (Array.isArray(pathParametersInput)) {
        parseEntries(pathParametersInput, "path", `${location}.pathParameters`);
    } else if (pathParametersInput !== undefined && pathParametersInput !== null) {
        addWarning(`Ignored invalid pathParameters at ${location}.pathParameters. Expected an array.`);
    }

    return parsed;
}

function applyPathParametersToUrl(url: string, parameters: ParsedParameter[]): string {
    let nextUrl = url;
    for (const parameter of parameters) {
        if (parameter.type !== "path") continue;
        const fallback = parameter.value || `{{${parameter.name}}}`;
        const bracesPattern = new RegExp(`\\{${parameter.name}\\}`, "g");
        const colonPattern = new RegExp(`:${parameter.name}(?=\\b|/|$)`, "g");
        nextUrl = nextUrl.replace(bracesPattern, fallback);
        nextUrl = nextUrl.replace(colonPattern, fallback);
    }
    return nextUrl;
}

function parseJsonBodyOrNull(text: string): unknown | null {
    const trimmed = text.trim();
    if (!trimmed) return {};
    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

function mapJsonBody(
    rawText: string,
    mimeType: string,
    location: string,
    addWarning: (message: string) => void
): Request["body"] {
    const parsed = parseJsonBodyOrNull(rawText);
    if (parsed !== null) {
        return {
            type: "json",
            value: parsed,
            text: rawText,
        };
    }

    addWarning(`Imported invalid JSON body as raw text at ${location}.`);
    return {
        type: "raw",
        content_type: mimeType,
        text: rawText,
    };
}

function mapFormBodyFromParams(
    paramsInput: unknown,
    location: string,
    addWarning: (message: string) => void,
    detectTemplateSyntax: (value: string) => void
): Extract<Request["body"], { type: "form" }> {
    if (!Array.isArray(paramsInput)) {
        addWarning(`Ignored invalid form body at ${location}. Expected a params array.`);
        return { type: "form", fields: [] };
    }

    const fields: KeyValue[] = [];
    for (const [index, rawField] of paramsInput.entries()) {
        if (!isObject(rawField)) {
            addWarning(`Ignored invalid form field at ${location}.params[${index}].`);
            continue;
        }
        if (asBoolean(rawField.disabled) === true) continue;
        const name = asTrimmedString(rawField.name);
        if (!name) continue;
        const value = valueToString(rawField.value);
        detectTemplateSyntax(value);
        fields.push({
            key: name,
            value,
        });
    }

    return { type: "form", fields };
}

function mapMultipartBodyFromParams(
    paramsInput: unknown,
    location: string,
    addWarning: (message: string) => void,
    detectTemplateSyntax: (value: string) => void
): Extract<Request["body"], { type: "multipart" }> {
    if (!Array.isArray(paramsInput)) {
        addWarning(`Ignored invalid multipart body at ${location}. Expected a params array.`);
        return { type: "multipart", fields: [] };
    }

    const fields: Extract<Request["body"], { type: "multipart" }>["fields"] = [];
    for (const [index, rawField] of paramsInput.entries()) {
        if (!isObject(rawField)) {
            addWarning(`Ignored invalid multipart field at ${location}.params[${index}].`);
            continue;
        }
        if (asBoolean(rawField.disabled) === true) continue;

        const name = asTrimmedString(rawField.name);
        if (!name) continue;

        const rawType = asTrimmedString(rawField.type)?.toLowerCase() ?? "text";
        if (rawType === "file") {
            const filePath = asTrimmedString(rawField.fileName) ?? asTrimmedString(rawField.value) ?? "";
            const fileField = createMultipartFileField(filePath);
            fields.push({
                ...fileField,
                name,
            });
            if (!filePath) {
                addWarning(`Imported multipart file field '${name}' without a file path at ${location}.`);
            }
            continue;
        }

        const textField = createMultipartTextField();
        const value = valueToString(rawField.value);
        detectTemplateSyntax(value);
        fields.push({
            ...textField,
            name,
            value,
        });
    }

    return { type: "multipart", fields };
}

function mapBody(
    bodyInput: unknown,
    location: string,
    addWarning: (message: string) => void,
    detectTemplateSyntax: (value: string) => void
): Request["body"] {
    if (!isObject(bodyInput)) {
        return { type: "none" };
    }

    const mimeTypeRaw = asTrimmedString(bodyInput.mimeType);
    const mimeType = mimeTypeRaw ?? "";
    const mimeTypeBase = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
    const text = valueToString(bodyInput.text);
    const bodyFileName = asTrimmedString(bodyInput.fileName) ?? "";
    detectTemplateSyntax(text);

    if (mimeTypeBase === "application/json" || mimeTypeBase.endsWith("+json")) {
        return mapJsonBody(text, mimeType || "application/json", location, addWarning);
    }

    if (mimeTypeBase === "application/x-www-form-urlencoded") {
        return mapFormBodyFromParams(
            bodyInput.params,
            location,
            addWarning,
            detectTemplateSyntax
        );
    }

    if (mimeTypeBase === "multipart/form-data") {
        return mapMultipartBodyFromParams(
            bodyInput.params,
            location,
            addWarning,
            detectTemplateSyntax
        );
    }

    if (mimeTypeBase === "application/octet-stream" || bodyFileName.length > 0) {
        addWarning(`Imported unsupported binary/file body as raw text at ${location}.`);
        return {
            type: "raw",
            content_type: mimeType || "application/octet-stream",
            text: bodyFileName || text,
        };
    }

    if (!mimeTypeBase) {
        if (Array.isArray(bodyInput.params) && bodyInput.params.length > 0) {
            const hasFileParam = bodyInput.params.some(
                (entry) =>
                    isObject(entry) &&
                    (asTrimmedString(entry.type)?.toLowerCase() === "file" || !!asTrimmedString(entry.fileName))
            );
            if (hasFileParam) {
                addWarning(`Imported body without mimeType as multipart/form-data at ${location}.`);
                return mapMultipartBodyFromParams(
                    bodyInput.params,
                    location,
                    addWarning,
                    detectTemplateSyntax
                );
            }

            addWarning(`Imported body without mimeType as application/x-www-form-urlencoded at ${location}.`);
            return mapFormBodyFromParams(
                bodyInput.params,
                location,
                addWarning,
                detectTemplateSyntax
            );
        }

        if (text.length > 0) {
            return {
                type: "raw",
                content_type: "text/plain",
                text,
            };
        }

        return { type: "none" };
    }

    return {
        type: "raw",
        content_type: mimeType,
        text,
    };
}

function resolveEffectiveAuth(
    authInput: unknown,
    inheritedAuth: InsomniaV5Authentication | null
): InsomniaV5Authentication | null {
    if (authInput === undefined || authInput === null) {
        return inheritedAuth;
    }
    if (!isObject(authInput)) {
        return inheritedAuth;
    }
    if (Object.keys(authInput).length === 0) {
        return inheritedAuth;
    }

    const type = asTrimmedString(authInput.type)?.toLowerCase();
    if (!type || type === "none") {
        return null;
    }
    if (asBoolean(authInput.disabled) === true) {
        return null;
    }

    return authInput as InsomniaV5Authentication;
}

function mapAuthToBifrost(
    authInput: unknown,
    inheritedAuth: InsomniaV5Authentication | null,
    headers: KeyValue[],
    query: KeyValue[],
    location: string,
    addWarning: (message: string) => void,
    detectTemplateSyntax: (value: string) => void
): RequestAuth {
    const auth = resolveEffectiveAuth(authInput, inheritedAuth);
    if (!auth) {
        return { type: "none" };
    }

    const type = asTrimmedString(auth.type)?.toLowerCase();
    if (!type || type === "none") {
        return { type: "none" };
    }

    if (type === "bearer") {
        const token = valueToString(auth.token);
        const prefix = asTrimmedString(auth.prefix) ?? "Bearer";
        detectTemplateSyntax(token);
        if (prefix.toLowerCase() === "bearer") {
            return { type: "bearer", token };
        }
        upsertHeader(headers, "Authorization", `${prefix} ${token}`.trim());
        addWarning(`Imported bearer auth with custom prefix as Authorization header at ${location}.`);
        return { type: "none" };
    }

    if (type === "basic") {
        const username = valueToString(auth.username);
        const password = valueToString(auth.password);
        detectTemplateSyntax(username);
        detectTemplateSyntax(password);
        return {
            type: "basic",
            username,
            password,
        };
    }

    if (type === "apikey") {
        const key = asTrimmedString(auth.key) ?? "x-api-key";
        const value = valueToString(auth.value);
        const addTo = asTrimmedString(auth.addTo)?.toLowerCase() ?? "header";
        detectTemplateSyntax(key);
        detectTemplateSyntax(value);
        return {
            type: "api_key",
            key,
            value,
            in: addTo === "queryparams" || addTo === "query" ? "query" : "header",
        };
    }

    if (type === "oauth2") {
        const accessToken = asTrimmedString(auth.accessToken);
        const tokenPrefix = asTrimmedString(auth.tokenPrefix) ?? "Bearer";
        if (accessToken) {
            detectTemplateSyntax(accessToken);
            if (tokenPrefix.toLowerCase() === "bearer") {
                addWarning(`Imported OAuth2 auth as bearer token at ${location}.`);
                return {
                    type: "bearer",
                    token: accessToken,
                };
            }
            upsertHeader(headers, "Authorization", `${tokenPrefix} ${accessToken}`.trim());
            addWarning(`Imported OAuth2 auth with custom token prefix as Authorization header at ${location}.`);
            return { type: "none" };
        }
        addWarning(`Ignored unsupported OAuth2 config without access token at ${location}.`);
        return { type: "none" };
    }

    if (type === "singletoken") {
        const token = valueToString(auth.token);
        detectTemplateSyntax(token);
        upsertHeader(headers, "Authorization", token);
        addWarning(`Imported singleToken auth as Authorization header at ${location}.`);
        return { type: "none" };
    }

    if (type === "iam") {
        const accessKeyId = asTrimmedString(auth.accessKeyId);
        if (accessKeyId) {
            detectTemplateSyntax(accessKeyId);
            query.push({ key: "accessKeyId", value: accessKeyId });
        }
    }

    addWarning(`Ignored unsupported auth type '${type}' at ${location}.`);
    return { type: "none" };
}

function mapScripts(
    scriptsInput: unknown
): ScriptMappingResult {
    if (!isObject(scriptsInput)) {
        return {
            scripts: { pre_request: "", post_response: "" },
            importedAny: false,
        };
    }

    const preRequest = asString(scriptsInput.preRequest) ?? "";
    const afterResponse = asString(scriptsInput.afterResponse) ?? "";

    return {
        scripts: {
            pre_request: preRequest,
            post_response: afterResponse,
        },
        importedAny: preRequest.length > 0 || afterResponse.length > 0,
    };
}

function isHttpRequestItem(item: InsomniaV5CollectionItem): boolean {
    return asTrimmedString((item as JsonObject).method) !== null;
}

function isGroupItem(item: InsomniaV5CollectionItem): boolean {
    const source = item as JsonObject;
    if (Array.isArray(source.children)) {
        return true;
    }
    if (source.method !== undefined) {
        return false;
    }
    if (
        source.url !== undefined ||
        source.reflectionApi !== undefined ||
        source.protoMethodName !== undefined ||
        source.eventListeners !== undefined ||
        source.transportType !== undefined
    ) {
        return false;
    }
    return true;
}

function itemName(item: JsonObject, fallback: string): string {
    return asTrimmedString(item.name) ?? fallback;
}

function includesInsomniaTemplateSyntax(value: string): boolean {
    return /{%\s*[\s\S]*?%}/.test(value) || /\{\{\s*_\./.test(value);
}

export function mapInsomniaV5ToBifrost(
    document: InsomniaV5CollectionDocument,
    sourceFileName: string
): InsomniaV5ImportPlan {
    const warnings = new Set<string>();
    const addWarning = (message: string) => warnings.add(message);
    let hasInsomniaTemplateSyntax = false;
    const detectTemplateSyntax = (value: string) => {
        if (!value) return;
        if (includesInsomniaTemplateSyntax(value)) {
            hasInsomniaTemplateSyntax = true;
        }
    };

    const collectionName = asTrimmedString(document.name) ?? fileNameWithoutExtension(sourceFileName);
    const generatedRequests: InsomniaV5GeneratedRequest[] = [];
    let totalItems = 0;
    let skippedItems = 0;
    let folderCount = 0;
    let importedScriptCount = 0;
    let ignoredFolderScriptCount = 0;
    let ignoredFolderEnvironmentCount = 0;

    const visitItems = (itemsInput: unknown, context: ImportContext) => {
        if (!Array.isArray(itemsInput)) {
            if (itemsInput !== undefined) {
                addWarning(`Ignored invalid collection items at '${context.folderPath.join("/") || "root"}'.`);
            }
            return;
        }

        for (const itemInput of itemsInput) {
            totalItems += 1;

            if (!isObject(itemInput)) {
                skippedItems += 1;
                addWarning(`Skipped invalid collection item at '${context.folderPath.join("/") || "root"}'.`);
                continue;
            }

            if (isGroupItem(itemInput)) {
                const groupName = itemName(itemInput, "Untitled Folder");
                folderCount += 1;

                const groupHeaders = parseHeaders(
                    itemInput.headers,
                    `folder '${groupName}' headers`,
                    addWarning,
                    detectTemplateSyntax
                );
                const inheritedHeaders = mergeHeaders(context.inheritedHeaders, groupHeaders);
                const nextInheritedAuth = resolveEffectiveAuth(itemInput.authentication, context.inheritedAuth);
                const nextContext: ImportContext = {
                    folderPath: [...context.folderPath, groupName],
                    inheritedHeaders,
                    inheritedAuth: nextInheritedAuth,
                };

                const groupScripts = mapScripts(itemInput.scripts);
                if (groupScripts.importedAny) {
                    ignoredFolderScriptCount += 1;
                }
                if (itemInput.environment !== undefined) {
                    ignoredFolderEnvironmentCount += 1;
                }

                if (!Array.isArray(itemInput.children)) {
                    if (
                        itemInput.url !== undefined ||
                        itemInput.reflectionApi !== undefined ||
                        itemInput.protoMethodName !== undefined
                    ) {
                        skippedItems += 1;
                        addWarning(
                            `Skipped unsupported non-HTTP item '${groupName}'. Only HTTP requests are imported.`
                        );
                    }
                    continue;
                }

                visitItems(itemInput.children, nextContext);
                continue;
            }

            if (!isHttpRequestItem(itemInput)) {
                skippedItems += 1;
                const unsupportedName = itemName(itemInput, "unnamed");
                addWarning(`Skipped unsupported item '${unsupportedName}'. Only HTTP requests are imported.`);
                continue;
            }

            const requestName = itemName(itemInput, "Imported request");
            const method = normalizeMethod(itemInput.method);
            if (!method) {
                skippedItems += 1;
                addWarning(`Skipped request '${requestName}' because method is missing or unsupported.`);
                continue;
            }

            const rawUrl = asTrimmedString(itemInput.url) ?? "/";
            detectTemplateSyntax(rawUrl);

            const parameters = parseParameters(
                itemInput.parameters,
                itemInput.pathParameters,
                `request '${requestName}'`,
                addWarning,
                detectTemplateSyntax
            );
            const url = applyPathParametersToUrl(rawUrl, parameters);
            const query = parameters
                .filter((entry) => entry.type === "query")
                .map((entry) => ({
                    key: entry.name,
                    value: entry.value,
                }));

            const requestHeaders = parseHeaders(
                itemInput.headers,
                `request '${requestName}' headers`,
                addWarning,
                detectTemplateSyntax
            );
            const headers = mergeHeaders(context.inheritedHeaders, requestHeaders);

            const body = mapBody(
                itemInput.body,
                `request '${requestName}' body`,
                addWarning,
                detectTemplateSyntax
            );

            const auth = mapAuthToBifrost(
                itemInput.authentication,
                context.inheritedAuth,
                headers,
                query,
                `request '${requestName}' auth`,
                addWarning,
                detectTemplateSyntax
            );

            const mappedScripts = mapScripts(itemInput.scripts);
            if (mappedScripts.importedAny) {
                importedScriptCount += 1;
            }
            detectTemplateSyntax(mappedScripts.scripts.pre_request);
            detectTemplateSyntax(mappedScripts.scripts.post_response);

            generatedRequests.push({
                folderPath: context.folderPath,
                request: {
                    id: crypto.randomUUID(),
                    name: requestName,
                    method,
                    url,
                    headers,
                    query,
                    body,
                    auth,
                    extractors: [],
                    scripts: mappedScripts.scripts,
                },
            });
        }
    };

    const initialContext: ImportContext = {
        folderPath: [],
        inheritedHeaders: [],
        inheritedAuth: null,
    };

    visitItems(document.collection, initialContext);

    if (generatedRequests.length === 0) {
        throw new Error("No importable HTTP requests were found in the Insomnia V5 file.");
    }

    if (importedScriptCount > 0) {
        addWarning(
            "Insomnia scripts were imported without modification. They may not work out of the box in Bifrost. Please update them to use the bf scripting API."
        );
    }
    if (ignoredFolderScriptCount > 0) {
        addWarning(
            `Skipped ${ignoredFolderScriptCount} folder-level script block(s). Bifrost only supports request-level scripts.`
        );
    }
    if (ignoredFolderEnvironmentCount > 0) {
        addWarning(
            `Skipped ${ignoredFolderEnvironmentCount} folder-level environment object(s).`
        );
    }
    if (hasInsomniaTemplateSyntax) {
        addWarning(
            "Some Insomnia template tags/variables were preserved as raw values. Review them before running requests in Bifrost."
        );
    }

    return {
        collectionName,
        requests: generatedRequests,
        warnings: Array.from(warnings),
        preview: {
            schemaVersion: asTrimmedString(document.schema_version),
            requestCount: generatedRequests.length,
            folderCount,
        },
        stats: {
            totalItems,
            importedRequests: generatedRequests.length,
            skippedItems,
            folderCount,
        },
    };
}
