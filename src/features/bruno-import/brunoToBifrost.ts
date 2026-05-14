import {
    createMultipartFileField,
    createMultipartTextField,
} from "../../helpers/requestBodyUtils.ts";
import type { KeyValue, Request, RequestAuth } from "../../types.ts";
import type {
    BrunoGeneratedRequest,
    BrunoImportPlan,
    BrunoOpenCollectionDocument,
    BrunoRequestDefaults,
    JsonObject,
} from "./brunoTypes.ts";

const SUPPORTED_METHODS = new Map<string, Request["method"]>([
    ["GET", "get"],
    ["POST", "post"],
    ["PUT", "put"],
    ["PATCH", "patch"],
    ["DELETE", "delete"],
    ["HEAD", "head"],
    ["OPTIONS", "options"],
]);

type MappedParam = {
    type: "query" | "path";
    name: string;
    value: string;
};

type ImportContext = {
    folderPath: string[];
    inheritedHeaders: KeyValue[];
    inheritedAuth: unknown | null;
};

type ScriptMappingResult = {
    scripts: Request["scripts"];
    importedAny: boolean;
    unknownTypesDetected: boolean;
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

function headerKey(header: KeyValue): string {
    return header.key.trim().toLowerCase();
}

function mergeHeaders(base: KeyValue[], overrides: KeyValue[]): KeyValue[] {
    const merged = base.map((entry) => ({ ...entry }));
    const indices = new Map<string, number>();

    for (const [index, header] of merged.entries()) {
        indices.set(headerKey(header), index);
    }

    for (const header of overrides) {
        const next = { ...header };
        const key = headerKey(next);
        if (!key) continue;
        const existingIndex = indices.get(key);
        if (existingIndex === undefined) {
            indices.set(key, merged.length);
            merged.push(next);
            continue;
        }
        merged[existingIndex] = next;
    }

    return merged;
}

function upsertHeader(headers: KeyValue[], key: string, value: string) {
    const normalized = key.trim().toLowerCase();
    const index = headers.findIndex((entry) => entry.key.trim().toLowerCase() === normalized);
    if (index === -1) {
        headers.push({ key, value });
        return;
    }
    headers[index] = { key, value };
}

function upsertQuery(query: KeyValue[], key: string, value: string) {
    const index = query.findIndex((entry) => entry.key === key);
    if (index === -1) {
        query.push({ key, value });
        return;
    }
    query[index] = { key, value };
}

function fileNameWithoutExtension(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return "Bruno Collection";
    const normalized = trimmed.replace(/\\/g, "/");
    const base = normalized.split("/").pop() ?? normalized;
    const stripped = base.replace(/\.(yaml|yml)$/i, "").trim();
    return stripped || "Bruno Collection";
}

function normalizeMethod(methodInput: unknown): Request["method"] | null {
    const method = asTrimmedString(methodInput);
    if (!method) return null;
    return SUPPORTED_METHODS.get(method.toUpperCase()) ?? null;
}

function parseHeaders(
    headersInput: unknown,
    location: string,
    addWarning: (message: string) => void
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

        const disabled = asBoolean(entry.disabled) === true;
        if (disabled) continue;

        const name = asTrimmedString(entry.name);
        if (!name) continue;
        headers.push({
            key: name,
            value: valueToString(entry.value),
        });
    }

    return headers;
}

function parseParams(
    paramsInput: unknown,
    location: string,
    addWarning: (message: string) => void
): MappedParam[] {
    if (paramsInput === undefined || paramsInput === null) {
        return [];
    }

    const result: MappedParam[] = [];
    const parseParamArray = (entries: unknown[], forcedType: "query" | "path" | null) => {
        for (const [index, rawEntry] of entries.entries()) {
            if (!isObject(rawEntry)) {
                addWarning(`Ignored invalid param at ${location}[${index}].`);
                continue;
            }
            if (asBoolean(rawEntry.disabled) === true) {
                continue;
            }

            const name = asTrimmedString(rawEntry.name);
            if (!name) continue;

            const rawType = forcedType ?? asTrimmedString(rawEntry.type)?.toLowerCase() ?? "query";
            if (rawType !== "query" && rawType !== "path") {
                addWarning(`Ignored unsupported param type '${rawType}' for '${name}' at ${location}.`);
                continue;
            }

            result.push({
                type: rawType,
                name,
                value: valueToString(rawEntry.value),
            });
        }
    };

    if (Array.isArray(paramsInput)) {
        parseParamArray(paramsInput, null);
        return result;
    }

    if (!isObject(paramsInput)) {
        addWarning(`Ignored invalid params at ${location}. Expected an array or object.`);
        return result;
    }

    let hasKnownGroup = false;
    if (Array.isArray(paramsInput.query)) {
        hasKnownGroup = true;
        parseParamArray(paramsInput.query, "query");
    }
    if (Array.isArray(paramsInput.path)) {
        hasKnownGroup = true;
        parseParamArray(paramsInput.path, "path");
    }

    if (!hasKnownGroup) {
        addWarning(`Ignored invalid params at ${location}.`);
    }

    return result;
}

function parseRequestDefaults(
    defaultsInput: unknown,
    location: string,
    addWarning: (message: string) => void
): BrunoRequestDefaults {
    if (!isObject(defaultsInput)) {
        return { headers: [], hasAuth: false, auth: null };
    }

    return {
        headers: parseHeaders(defaultsInput.headers, `${location}.headers`, addWarning),
        hasAuth: "auth" in defaultsInput,
        auth: defaultsInput.auth ?? null,
    };
}

function resolveEffectiveAuth(authInput: unknown, inheritedAuth: unknown | null): unknown | null {
    if (authInput === undefined || authInput === null) {
        return null;
    }

    if (typeof authInput === "string") {
        const normalized = authInput.trim().toLowerCase();
        if (!normalized || normalized === "none") return null;
        if (normalized === "inherit") return inheritedAuth;
        return authInput;
    }

    if (!isObject(authInput)) {
        return authInput;
    }

    const type = asTrimmedString(authInput.type)?.toLowerCase();
    if (!type || type === "none") return null;
    if (type === "inherit") return inheritedAuth;
    return authInput;
}

function mapAuthToBifrost(
    authInput: unknown,
    inheritedAuth: unknown | null,
    headers: KeyValue[],
    query: KeyValue[],
    location: string,
    addWarning: (message: string) => void
): RequestAuth {
    const effectiveAuth = resolveEffectiveAuth(authInput, inheritedAuth);
    if (!effectiveAuth) {
        return { type: "none" };
    }

    if (!isObject(effectiveAuth)) {
        addWarning(`Ignored unsupported auth format at ${location}.`);
        return { type: "none" };
    }

    const authType = asTrimmedString(effectiveAuth.type)?.toLowerCase();
    if (!authType || authType === "none") {
        return { type: "none" };
    }

    if (authType === "bearer") {
        return {
            type: "bearer",
            token: valueToString(effectiveAuth.token),
        };
    }

    if (authType === "basic") {
        return {
            type: "basic",
            username: valueToString(effectiveAuth.username),
            password: valueToString(effectiveAuth.password),
        };
    }

    if (authType === "apikey") {
        const key = asTrimmedString(effectiveAuth.key) ?? "x-api-key";
        const placement = asTrimmedString(effectiveAuth.placement)?.toLowerCase();
        return {
            type: "api_key",
            key,
            value: valueToString(effectiveAuth.value),
            in: placement === "query" ? "query" : "header",
        };
    }

    if (authType === "oauth2") {
        upsertHeader(headers, "Authorization", "Bearer {{token}}");
    } else if (authType === "digest") {
        upsertHeader(headers, "Authorization", "Digest {{credentials}}");
    } else if (authType === "ntlm") {
        upsertHeader(headers, "Authorization", "NTLM {{credentials}}");
    } else if (authType === "awsv4") {
        upsertHeader(headers, "Authorization", "AWS4-HMAC-SHA256 {{signature}}");
    } else if (authType === "wsse") {
        upsertHeader(headers, "Authorization", "WSSE {{credentials}}");
    } else if (authType === "oauth1") {
        upsertHeader(headers, "Authorization", "OAuth {{credentials}}");
    } else {
        const key = asTrimmedString(effectiveAuth.key);
        const placement = asTrimmedString(effectiveAuth.placement)?.toLowerCase();
        if (key) {
            if (placement === "query") {
                upsertQuery(query, key, valueToString(effectiveAuth.value));
            } else {
                upsertHeader(headers, key, valueToString(effectiveAuth.value));
            }
        }
    }

    addWarning(`Imported auth type '${authType}' as headers/query at ${location}.`);
    return { type: "none" };
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

function mapBodyFromTypeData(
    bodyType: string,
    data: unknown,
    location: string,
    addWarning: (message: string) => void
): Request["body"] {
    if (bodyType === "json") {
        const rawText = valueToString(data);
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
            content_type: "application/json",
            text: rawText,
        };
    }

    if (bodyType === "text") {
        return {
            type: "raw",
            content_type: "text/plain",
            text: valueToString(data),
        };
    }

    if (bodyType === "xml") {
        return {
            type: "raw",
            content_type: "application/xml",
            text: valueToString(data),
        };
    }

    if (bodyType === "sparql") {
        return {
            type: "raw",
            content_type: "application/sparql-query",
            text: valueToString(data),
        };
    }

    if (bodyType === "graphql") {
        return {
            type: "raw",
            content_type: "application/graphql",
            text: valueToString(data),
        };
    }

    if (bodyType === "form-urlencoded") {
        if (!Array.isArray(data)) {
            addWarning(`Ignored invalid form-urlencoded body at ${location}.`);
            return { type: "form", fields: [] };
        }

        const fields: KeyValue[] = [];
        for (const [index, field] of data.entries()) {
            if (!isObject(field)) {
                addWarning(`Ignored invalid form field at ${location}[${index}].`);
                continue;
            }
            if (asBoolean(field.disabled) === true) continue;

            const name = asTrimmedString(field.name);
            if (!name) continue;

            fields.push({
                key: name,
                value: valueToString(field.value),
            });
        }

        return { type: "form", fields };
    }

    if (bodyType === "multipart-form") {
        if (!Array.isArray(data)) {
            addWarning(`Ignored invalid multipart body at ${location}.`);
            return { type: "multipart", fields: [] };
        }

        const fields: NonNullable<Extract<Request["body"], { type: "multipart" }>["fields"]> = [];
        for (const [index, field] of data.entries()) {
            if (!isObject(field)) {
                addWarning(`Ignored invalid multipart field at ${location}[${index}].`);
                continue;
            }
            if (asBoolean(field.disabled) === true) continue;

            const name = asTrimmedString(field.name);
            if (!name) continue;

            const fieldType = asTrimmedString(field.type)?.toLowerCase() ?? "text";
            if (fieldType === "file") {
                const value = field.value;
                const filePath =
                    Array.isArray(value) && value.length > 0
                        ? valueToString(value[0])
                        : valueToString(value);
                const fileField = createMultipartFileField(filePath);
                fields.push({ ...fileField, name });
                continue;
            }

            const textField = createMultipartTextField();
            const value = Array.isArray(field.value)
                ? field.value.map((entry) => valueToString(entry)).join(",")
                : valueToString(field.value);
            fields.push({
                ...textField,
                name,
                value,
            });
        }

        return { type: "multipart", fields };
    }

    if (bodyType === "file") {
        const fileHint =
            Array.isArray(data) && data.length > 0
                ? valueToString((data[0] as JsonObject | undefined)?.filePath)
                : valueToString(data);
        addWarning(`Imported unsupported file body as raw text at ${location}.`);
        return {
            type: "raw",
            content_type: "application/octet-stream",
            text: fileHint,
        };
    }

    addWarning(`Imported unsupported body type '${bodyType}' as raw text at ${location}.`);
    return {
        type: "raw",
        content_type: "text/plain",
        text: valueToString(data),
    };
}

function mapLegacyModeBody(
    body: JsonObject,
    location: string,
    addWarning: (message: string) => void
): Request["body"] {
    const mode = asTrimmedString(body.mode)?.toLowerCase();
    if (!mode || mode === "none") {
        return { type: "none" };
    }

    if (mode === "json") {
        return mapBodyFromTypeData("json", body.json ?? "", location, addWarning);
    }
    if (mode === "text") {
        return mapBodyFromTypeData("text", body.text ?? "", location, addWarning);
    }
    if (mode === "xml") {
        return mapBodyFromTypeData("xml", body.xml ?? "", location, addWarning);
    }
    if (mode === "sparql") {
        return mapBodyFromTypeData("sparql", body.sparql ?? "", location, addWarning);
    }
    if (mode === "formurlencoded") {
        return mapBodyFromTypeData("form-urlencoded", body.formUrlEncoded, location, addWarning);
    }
    if (mode === "multipartform") {
        return mapBodyFromTypeData("multipart-form", body.multipartForm, location, addWarning);
    }
    if (mode === "file") {
        return mapBodyFromTypeData("file", body.file, location, addWarning);
    }

    addWarning(`Ignored unsupported legacy body mode '${mode}' at ${location}.`);
    return { type: "none" };
}

function mapBody(
    bodyInput: unknown,
    location: string,
    addWarning: (message: string) => void
): Request["body"] {
    if (bodyInput === undefined || bodyInput === null) {
        return { type: "none" };
    }

    const resolvedBodyInput =
        Array.isArray(bodyInput) && bodyInput.length > 0
            ? (() => {
                  const selected = bodyInput.find(
                      (entry) => isObject(entry) && asBoolean((entry as JsonObject).selected) === true
                  );
                  if (isObject(selected) && isObject(selected.body)) {
                      return selected.body;
                  }

                  const first = bodyInput[0];
                  if (isObject(first) && isObject(first.body)) {
                      return first.body;
                  }
                  return bodyInput;
              })()
            : bodyInput;

    if (!isObject(resolvedBodyInput)) {
        addWarning(`Ignored invalid body at ${location}.`);
        return { type: "none" };
    }

    const bodyType = asTrimmedString(resolvedBodyInput.type)?.toLowerCase();
    if (bodyType) {
        return mapBodyFromTypeData(bodyType, resolvedBodyInput.data, location, addWarning);
    }

    if ("mode" in resolvedBodyInput) {
        return mapLegacyModeBody(resolvedBodyInput, location, addWarning);
    }

    addWarning(`Ignored unsupported body shape at ${location}.`);
    return { type: "none" };
}

function mapRuntimeScripts(
    runtimeInput: unknown,
    location: string,
    addWarning: (message: string) => void
): ScriptMappingResult {
    const preRequestParts: string[] = [];
    const postResponseParts: string[] = [];
    let importedAny = false;
    let unknownTypesDetected = false;

    if (!isObject(runtimeInput)) {
        return {
            scripts: { pre_request: "", post_response: "" },
            importedAny,
            unknownTypesDetected,
        };
    }

    const scriptsInput = runtimeInput.scripts;
    if (scriptsInput === undefined || scriptsInput === null) {
        return {
            scripts: { pre_request: "", post_response: "" },
            importedAny,
            unknownTypesDetected,
        };
    }

    if (!Array.isArray(scriptsInput)) {
        addWarning(`Ignored invalid scripts at ${location}. Expected an array.`);
        return {
            scripts: { pre_request: "", post_response: "" },
            importedAny,
            unknownTypesDetected,
        };
    }

    for (const [index, entry] of scriptsInput.entries()) {
        if (!isObject(entry)) {
            addWarning(`Ignored invalid script block at ${location}[${index}].`);
            continue;
        }

        const code = asString(entry.code);
        if (code === null || code.length === 0) {
            continue;
        }

        importedAny = true;
        const scriptType = asTrimmedString(entry.type)?.toLowerCase() ?? "";
        if (scriptType === "before-request") {
            preRequestParts.push(code);
            continue;
        }

        if (scriptType === "after-response" || scriptType === "tests") {
            postResponseParts.push(code);
            continue;
        }

        unknownTypesDetected = true;
        postResponseParts.push(code);
        addWarning(
            `Imported unsupported Bruno script type '${scriptType || "unknown"}' into post-response script at ${location}.`
        );
    }

    const preRequestScript = preRequestParts.join("\n\n");
    const postResponseScript = postResponseParts.join("\n\n");

    return {
        scripts: {
            pre_request: preRequestScript,
            post_response: postResponseScript,
        },
        importedAny,
        unknownTypesDetected,
    };
}

function applyPathParamsToUrl(url: string, params: MappedParam[]): string {
    let nextUrl = url;
    for (const param of params) {
        if (param.type !== "path") continue;
        const fallback = param.value || `{{${param.name}}}`;
        const bracketPattern = new RegExp(`\\{${param.name}\\}`, "g");
        const colonPattern = new RegExp(`:${param.name}(?=\\b|/|$)`, "g");
        nextUrl = nextUrl.replace(bracketPattern, fallback);
        nextUrl = nextUrl.replace(colonPattern, fallback);
    }
    return nextUrl;
}

function itemName(item: JsonObject, fallback: string): string {
    const fromInfo = isObject(item.info) ? asTrimmedString(item.info.name) : null;
    return fromInfo ?? fallback;
}

function isFolderItem(item: JsonObject): boolean {
    const infoType = isObject(item.info) ? asTrimmedString(item.info.type)?.toLowerCase() : null;
    if (infoType === "folder") return true;
    if (!Array.isArray(item.items)) return false;
    return !isObject(item.http);
}

function isHttpRequestItem(item: JsonObject): boolean {
    if (isObject(item.http)) return true;
    const infoType = isObject(item.info) ? asTrimmedString(item.info.type)?.toLowerCase() : null;
    return infoType === "http";
}

export function mapBrunoToBifrost(
    document: BrunoOpenCollectionDocument,
    sourceFileName: string
): BrunoImportPlan {
    const warnings = new Set<string>();
    const addWarning = (message: string) => warnings.add(message);

    const info = isObject(document.info) ? document.info : {};
    const collectionName = asTrimmedString(info.name) ?? fileNameWithoutExtension(sourceFileName);
    const sourceVersion = document.opencollection;
    const bundled = typeof document.bundled === "boolean" ? document.bundled : null;

    const rootDefaults = parseRequestDefaults(document.request, "request defaults", addWarning);

    const generatedRequests: BrunoGeneratedRequest[] = [];
    let totalItems = 0;
    let skippedItems = 0;
    let folderCount = 0;
    let importedScriptCount = 0;
    let unknownScriptTypeCount = 0;

    const visitItems = (itemsInput: unknown, context: ImportContext) => {
        if (!Array.isArray(itemsInput)) {
            if (itemsInput !== undefined) {
                addWarning(`Ignored invalid items list at '${context.folderPath.join("/") || "root"}'.`);
            }
            return;
        }

        for (const itemInput of itemsInput) {
            totalItems += 1;

            if (!isObject(itemInput)) {
                skippedItems += 1;
                addWarning(`Skipped invalid item at '${context.folderPath.join("/") || "root"}'.`);
                continue;
            }

            if (isFolderItem(itemInput)) {
                folderCount += 1;
                const folderName = itemName(itemInput, "Untitled Folder");
                const folderDefaults = parseRequestDefaults(
                    itemInput.request,
                    `folder '${folderName}' defaults`,
                    addWarning
                );
                const nextContext: ImportContext = {
                    folderPath: [...context.folderPath, folderName],
                    inheritedHeaders: mergeHeaders(context.inheritedHeaders, folderDefaults.headers),
                    inheritedAuth: folderDefaults.hasAuth
                        ? resolveEffectiveAuth(folderDefaults.auth, context.inheritedAuth)
                        : context.inheritedAuth,
                };

                visitItems(itemInput.items, nextContext);
                continue;
            }

            if (!isHttpRequestItem(itemInput)) {
                skippedItems += 1;
                const unsupportedName = itemName(itemInput, "unnamed");
                addWarning(`Skipped unsupported item '${unsupportedName}'. Only HTTP requests are imported.`);
                continue;
            }

            const requestName = itemName(itemInput, "Imported request");
            const method = normalizeMethod((itemInput.http as JsonObject | undefined)?.method);
            if (!method) {
                skippedItems += 1;
                addWarning(`Skipped request '${requestName}' because method is missing or unsupported.`);
                continue;
            }

            const rawUrl = asTrimmedString((itemInput.http as JsonObject | undefined)?.url) ?? "";
            const httpUrl = rawUrl.length > 0 ? rawUrl : "/";
            const params = parseParams(
                (itemInput.http as JsonObject | undefined)?.params,
                `request '${requestName}' params`,
                addWarning
            );
            const url = applyPathParamsToUrl(httpUrl, params);

            const requestHeaders = parseHeaders(
                (itemInput.http as JsonObject | undefined)?.headers,
                `request '${requestName}' headers`,
                addWarning
            );
            const headers = mergeHeaders(context.inheritedHeaders, requestHeaders);
            const query = params
                .filter((entry) => entry.type === "query")
                .map((entry) => ({ key: entry.name, value: entry.value }));
            const body = mapBody(
                (itemInput.http as JsonObject | undefined)?.body,
                `request '${requestName}' body`,
                addWarning
            );
            const auth = mapAuthToBifrost(
                (itemInput.http as JsonObject | undefined)?.auth,
                context.inheritedAuth,
                headers,
                query,
                `request '${requestName}' auth`,
                addWarning
            );

            const scriptMapping = mapRuntimeScripts(
                itemInput.runtime,
                `request '${requestName}' runtime.scripts`,
                addWarning
            );
            if (scriptMapping.importedAny) {
                importedScriptCount += 1;
            }
            if (scriptMapping.unknownTypesDetected) {
                unknownScriptTypeCount += 1;
            }

            if (isObject(itemInput.runtime) && Array.isArray(itemInput.runtime.variables)) {
                addWarning(`Runtime variables for '${requestName}' were not imported as collection variables.`);
            }

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
                    scripts: scriptMapping.scripts,
                },
            });
        }
    };

    const initialContext: ImportContext = {
        folderPath: [],
        inheritedHeaders: rootDefaults.headers,
        inheritedAuth: rootDefaults.hasAuth ? resolveEffectiveAuth(rootDefaults.auth, null) : null,
    };
    visitItems(document.items, initialContext);

    if (generatedRequests.length === 0) {
        throw new Error("No importable HTTP requests were found in the Bruno/OpenCollection file.");
    }

    if (importedScriptCount > 0) {
        addWarning(
            "Bruno scripts were imported without modification. They may not work out of the box in Bifrost. Please update them to use the bf scripting API."
        );
    }
    if (unknownScriptTypeCount > 0) {
        addWarning(
            `Imported ${unknownScriptTypeCount} request(s) with non-standard Bruno script types into post-response scripts.`
        );
    }

    return {
        collectionName,
        requests: generatedRequests,
        warnings: Array.from(warnings),
        preview: {
            sourceVersion,
            bundled,
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
