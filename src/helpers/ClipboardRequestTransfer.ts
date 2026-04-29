import { readText as readTextFromPlugin, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type {
    Body,
    KeyValue,
    MultipartField,
    Request,
    RequestAuth,
    RequestScripts,
    ResponseExtractorRule,
} from "../types.ts";

export const BIFROST_CLIPBOARD_REQUEST_VERSION = 1 as const;

export type BifrostClipboardRequestPayloadV1 = {
    bifrostType: "request";
    version: typeof BIFROST_CLIPBOARD_REQUEST_VERSION;
    request: Request;
};

const REQUEST_METHODS = new Set([
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
]);

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKeyValueArray(value: unknown): value is KeyValue[] {
    return (
        Array.isArray(value) &&
        value.every(
            (entry) =>
                isObject(entry) &&
                typeof entry.key === "string" &&
                typeof entry.value === "string"
        )
    );
}

function isMultipartFieldArray(value: unknown): value is MultipartField[] {
    return (
        Array.isArray(value) &&
        value.every((entry) => {
            if (!isObject(entry)) return false;
            if (typeof entry.id !== "string") return false;
            if (typeof entry.enabled !== "boolean") return false;
            if (typeof entry.name !== "string") return false;
            if (entry.kind === "text") {
                return typeof entry.value === "string";
            }
            if (entry.kind === "file") {
                if (typeof entry.file_path !== "string") return false;
                if (
                    entry.file_name !== undefined &&
                    entry.file_name !== null &&
                    typeof entry.file_name !== "string"
                ) {
                    return false;
                }
                if (
                    entry.mime_type !== undefined &&
                    entry.mime_type !== null &&
                    typeof entry.mime_type !== "string"
                ) {
                    return false;
                }
                if (
                    entry.size !== undefined &&
                    entry.size !== null &&
                    typeof entry.size !== "number"
                ) {
                    return false;
                }
                return true;
            }
            return false;
        })
    );
}

function parseBody(value: unknown): Body | null {
    if (!isObject(value) || typeof value.type !== "string") return null;

    if (value.type === "none") {
        return { type: "none" };
    }

    if (value.type === "raw") {
        if (typeof value.content_type !== "string" || typeof value.text !== "string") {
            return null;
        }
        return {
            type: "raw",
            content_type: value.content_type,
            text: value.text,
        };
    }

    if (value.type === "json") {
        return {
            type: "json",
            value: value.value,
            text: typeof value.text === "string" ? value.text : undefined,
        };
    }

    if (value.type === "form") {
        if (!isKeyValueArray(value.fields)) return null;
        return {
            type: "form",
            fields: value.fields,
        };
    }

    if (value.type === "multipart") {
        if (!isMultipartFieldArray(value.fields)) return null;
        return {
            type: "multipart",
            fields: value.fields.map((field) =>
                field.kind === "text"
                    ? field
                    : {
                        ...field,
                        file_name: field.file_name ?? undefined,
                        mime_type: field.mime_type ?? undefined,
                        size: field.size ?? undefined,
                    }
            ),
        };
    }

    return null;
}

function parseAuth(value: unknown): RequestAuth | null {
    if (!isObject(value) || typeof value.type !== "string") return null;

    if (value.type === "none") {
        return { type: "none" };
    }

    if (value.type === "bearer") {
        if (typeof value.token !== "string") return null;
        return { type: "bearer", token: value.token };
    }

    if (value.type === "basic") {
        if (typeof value.username !== "string" || typeof value.password !== "string") {
            return null;
        }
        return {
            type: "basic",
            username: value.username,
            password: value.password,
        };
    }

    if (value.type === "api_key") {
        if (
            typeof value.key !== "string" ||
            typeof value.value !== "string" ||
            (value.in !== "header" && value.in !== "query")
        ) {
            return null;
        }
        return {
            type: "api_key",
            key: value.key,
            value: value.value,
            in: value.in,
        };
    }

    return null;
}

function parseExtractors(value: unknown): ResponseExtractorRule[] | null {
    if (!Array.isArray(value)) return null;

    const out: ResponseExtractorRule[] = [];
    for (const entry of value) {
        if (!isObject(entry) || typeof entry.id !== "string" || typeof entry.variable !== "string") {
            return null;
        }

        if (entry.from === "json_body") {
            if (typeof entry.path !== "string") return null;
            out.push({
                id: entry.id,
                from: "json_body",
                variable: entry.variable,
                path: entry.path,
            });
            continue;
        }

        if (entry.from === "header") {
            if (typeof entry.header !== "string") return null;
            out.push({
                id: entry.id,
                from: "header",
                variable: entry.variable,
                header: entry.header,
            });
            continue;
        }

        return null;
    }

    return out;
}

function parseScripts(value: unknown): RequestScripts | null {
    if (!isObject(value)) return null;
    if (typeof value.pre_request !== "string" || typeof value.post_response !== "string") {
        return null;
    }
    return {
        pre_request: value.pre_request,
        post_response: value.post_response,
    };
}

function parseRequest(value: unknown): Request | null {
    if (!isObject(value)) return null;
    if (typeof value.id !== "string" || typeof value.name !== "string") return null;
    if (typeof value.method !== "string" || !REQUEST_METHODS.has(value.method)) return null;
    if (typeof value.url !== "string") return null;
    if (value.headers !== undefined && !isKeyValueArray(value.headers)) return null;
    if (value.query !== undefined && !isKeyValueArray(value.query)) return null;

    const body =
        value.body === undefined
            ? ({ type: "none" } satisfies Body)
            : parseBody(value.body);
    const auth =
        value.auth === undefined
            ? ({ type: "none" } satisfies RequestAuth)
            : parseAuth(value.auth);
    const extractors =
        value.extractors === undefined
            ? []
            : parseExtractors(value.extractors);
    const scripts =
        value.scripts === undefined
            ? ({ pre_request: "", post_response: "" } satisfies RequestScripts)
            : parseScripts(value.scripts);
    if (!body || !auth || !extractors || !scripts) return null;

    return {
        id: value.id,
        name: value.name,
        method: value.method as Request["method"],
        url: value.url,
        headers: value.headers ?? [],
        query: value.query ?? [],
        body,
        auth,
        extractors,
        scripts,
    };
}

export function serializeRequestForClipboard(request: Request): string {
    const payload: BifrostClipboardRequestPayloadV1 = {
        bifrostType: "request",
        version: BIFROST_CLIPBOARD_REQUEST_VERSION,
        request: {
            id: request.id,
            name: request.name,
            method: request.method,
            url: request.url,
            headers: request.headers,
            query: request.query,
            body: request.body,
            auth: request.auth,
            extractors: request.extractors,
            scripts: request.scripts,
        },
    };

    return JSON.stringify(payload, null, 2);
}

export function parseBifrostClipboardPayload(text: string): BifrostClipboardRequestPayloadV1 | null {
    try {
        const parsed = JSON.parse(text) as unknown;
        if (!isObject(parsed)) return null;
        if (parsed.bifrostType !== "request") return null;
        if (parsed.version !== BIFROST_CLIPBOARD_REQUEST_VERSION) return null;

        const request = parseRequest(parsed.request);
        if (!request) return null;

        return {
            bifrostType: "request",
            version: BIFROST_CLIPBOARD_REQUEST_VERSION,
            request,
        };
    } catch {
        return null;
    }
}

export function isBifrostClipboardRequestPayload(text: string): boolean {
    return parseBifrostClipboardPayload(text) !== null;
}

export async function copyRequestToClipboard(request: Request): Promise<void> {
    const serialized = serializeRequestForClipboard(request);
    await copyTextToClipboard(serialized);
}

export async function copyTextToClipboard(text: string): Promise<void> {
    if (!text) {
        throw new Error("Nothing to copy.");
    }

    try {
        await writeText(text);
        return;
    } catch {
        // Fall through to browser clipboard APIs when plugin clipboard is unavailable.
    }

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    if (typeof document === "undefined" || !document.body) {
        throw new Error("Clipboard API is unavailable.");
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);

    try {
        const copied = document.execCommand("copy");
        if (!copied) {
            throw new Error("Failed to copy.");
        }
    } finally {
        document.body.removeChild(textarea);
    }
}

export async function readRequestFromClipboard(): Promise<BifrostClipboardRequestPayloadV1 | null> {
    const text = await readTextFromClipboard();
    if (typeof text !== "string" || text.trim().length === 0) return null;
    return parseBifrostClipboardPayload(text);
}

export async function readTextFromClipboard(): Promise<string> {
    try {
        return await readTextFromPlugin();
    } catch {
        // Fall through to browser clipboard APIs when plugin clipboard is unavailable.
    }

    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
        return navigator.clipboard.readText();
    }

    throw new Error("Clipboard read API is unavailable.");
}
