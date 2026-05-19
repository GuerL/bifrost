import type { GeneratedHeaderControl, GeneratedHeaderName, KeyValue, Request } from "../types.ts";

const VARIABLE_PATTERN = /{{\s*([^{}]+?)\s*}}/g;

export const CALCULATED_HEADER_VALUE = "<calculated when request is sent>";
export const NOT_SET_HEADER_VALUE = "<not set>";
export const GENERATED_HEADER_DISABLE_WARNING =
    "Disabling generated headers may cause server errors such as 400 Bad Request.";

type GeneratedHeaderMeta = {
    key: GeneratedHeaderName;
    label: string;
    note: string;
};

const GENERATED_HEADERS: GeneratedHeaderMeta[] = [
    { key: "host", label: "Host", note: "Derived from request URL" },
    { key: "user-agent", label: "User-Agent", note: "Not set by default" },
    { key: "accept", label: "Accept", note: "reqwest default" },
    { key: "accept-encoding", label: "Accept-Encoding", note: "Managed by HTTP client" },
    { key: "connection", label: "Connection", note: "Managed by HTTP client" },
    { key: "content-length", label: "Content-Length", note: "Calculated from request body" },
    { key: "content-type", label: "Content-Type", note: "Derived from selected body type" },
    { key: "cookie", label: "Cookie", note: "No automatic cookie jar configured" },
];

export const GENERATED_HEADER_ORDER: GeneratedHeaderName[] = GENERATED_HEADERS.map(
    (item) => item.key
);

const GENERATED_HEADER_LABELS: Record<GeneratedHeaderName, string> = GENERATED_HEADERS.reduce(
    (acc, item) => {
        acc[item.key] = item.label;
        return acc;
    },
    {} as Record<GeneratedHeaderName, string>
);

export type GeneratedHeaderPreviewRow = {
    key: GeneratedHeaderName;
    label: string;
    value: string;
    enabled: boolean;
    note: string;
};

type BuildGeneratedHeadersPreviewArgs = {
    request: Request;
    variableValues?: Map<string, string>;
};

export function generatedHeaderLabel(headerName: GeneratedHeaderName): string {
    return GENERATED_HEADER_LABELS[headerName];
}

export function isGeneratedHeaderName(value: string): value is GeneratedHeaderName {
    const normalized = value.trim().toLowerCase();
    return (
        normalized === "host" ||
        normalized === "user-agent" ||
        normalized === "accept" ||
        normalized === "accept-encoding" ||
        normalized === "connection" ||
        normalized === "content-length" ||
        normalized === "content-type" ||
        normalized === "cookie"
    );
}

function resolveKnownVariables(input: string, variableValues: Map<string, string>): {
    value: string;
    unresolved: boolean;
} {
    let unresolved = false;
    const value = input.replace(VARIABLE_PATTERN, (rawMatch, rawName: string) => {
        const name = rawName.trim();
        if (!name) return rawMatch;
        const resolved = variableValues.get(name);
        if (resolved === undefined) {
            unresolved = true;
            return rawMatch;
        }
        return resolved;
    });

    return { value, unresolved };
}

function utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
}

function stripJsonComments(input: string): string {
    let out = "";
    let inString = false;
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        const next = input[i + 1] ?? "";

        if (inLineComment) {
            if (ch === "\n") {
                inLineComment = false;
                out += ch;
            }
            continue;
        }

        if (inBlockComment) {
            if (ch === "*" && next === "/") {
                inBlockComment = false;
                i += 1;
                continue;
            }
            if (ch === "\n") {
                out += ch;
            }
            continue;
        }

        if (inString) {
            out += ch;
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === "\"") {
                inString = false;
            }
            continue;
        }

        if (ch === "\"") {
            inString = true;
            out += ch;
            continue;
        }

        if (ch === "/" && next === "/") {
            inLineComment = true;
            i += 1;
            continue;
        }

        if (ch === "/" && next === "*") {
            inBlockComment = true;
            i += 1;
            continue;
        }

        out += ch;
    }

    return out;
}

function inferHost(url: string, variableValues: Map<string, string>): string {
    const resolved = resolveKnownVariables(url, variableValues);
    if (resolved.unresolved) {
        return CALCULATED_HEADER_VALUE;
    }

    try {
        const parsed = new URL(resolved.value);
        return parsed.host || CALCULATED_HEADER_VALUE;
    } catch {
        return CALCULATED_HEADER_VALUE;
    }
}

function inferContentLength(request: Request): string {
    const { body } = request;
    if (body.type === "raw") {
        return String(utf8ByteLength(body.text));
    }

    if (body.type === "json") {
        if (body.text && body.text.trim().length > 0) {
            return String(utf8ByteLength(stripJsonComments(body.text)));
        }
        try {
            const serialized = JSON.stringify(body.value);
            if (typeof serialized !== "string") return CALCULATED_HEADER_VALUE;
            return String(utf8ByteLength(serialized));
        } catch {
            return CALCULATED_HEADER_VALUE;
        }
    }

    if (body.type === "form") {
        const search = new URLSearchParams();
        for (const field of body.fields) {
            const key = field.key.trim();
            if (!key) continue;
            if (field.enabled === false) continue;
            search.append(key, field.value);
        }
        return String(utf8ByteLength(search.toString()));
    }

    if (body.type === "multipart") {
        return CALCULATED_HEADER_VALUE;
    }

    return CALCULATED_HEADER_VALUE;
}

function inferContentType(request: Request): string {
    const { body } = request;
    if (body.type === "raw") {
        const contentType = body.content_type.trim();
        return contentType || NOT_SET_HEADER_VALUE;
    }
    if (body.type === "json") {
        return "application/json";
    }
    if (body.type === "form") {
        return "application/x-www-form-urlencoded";
    }
    if (body.type === "multipart") {
        return CALCULATED_HEADER_VALUE;
    }
    return NOT_SET_HEADER_VALUE;
}

function inferGeneratedHeaderValue(
    key: GeneratedHeaderName,
    request: Request,
    variableValues: Map<string, string>
): string {
    if (key === "host") return inferHost(request.url, variableValues);
    if (key === "content-length") return inferContentLength(request);
    if (key === "content-type") return inferContentType(request);
    if (key === "accept") return "*/*";
    if (key === "user-agent") return NOT_SET_HEADER_VALUE;
    if (key === "accept-encoding") return CALCULATED_HEADER_VALUE;
    if (key === "connection") return CALCULATED_HEADER_VALUE;
    if (key === "cookie") return NOT_SET_HEADER_VALUE;
    return CALCULATED_HEADER_VALUE;
}

export function defaultGeneratedHeaderControls(): GeneratedHeaderControl[] {
    return GENERATED_HEADERS.map((item) => ({
        key: item.key,
        enabled: true,
    }));
}

export function generatedHeaderControlMap(
    request: Request
): Map<GeneratedHeaderName, boolean> {
    const map = new Map<GeneratedHeaderName, boolean>();
    for (const item of GENERATED_HEADERS) {
        map.set(item.key, true);
    }

    for (const control of request.generated_headers ?? []) {
        const normalized = control.key.toLowerCase() as GeneratedHeaderName;
        if (!map.has(normalized)) continue;
        map.set(normalized, control.enabled !== false);
    }

    return map;
}

export function generatedHeaderControlsWithDefaults(
    request: Request
): GeneratedHeaderControl[] {
    const enabledByKey = generatedHeaderControlMap(request);
    return GENERATED_HEADER_ORDER.map((key) => ({
        key,
        enabled: enabledByKey.get(key) !== false,
    }));
}

export function isHeaderEnabled(header: KeyValue): boolean {
    return header.enabled !== false;
}

export function enabledRequestHeaders(headers: KeyValue[]): KeyValue[] {
    return headers.filter((header) => isHeaderEnabled(header));
}

export function disabledRequestHeaders(headers: KeyValue[]): KeyValue[] {
    return headers.filter((header) => !isHeaderEnabled(header));
}

export function buildGeneratedHeadersPreview({
    request,
    variableValues,
}: BuildGeneratedHeadersPreviewArgs): GeneratedHeaderPreviewRow[] {
    const resolvedVariableValues = variableValues ?? new Map<string, string>();
    const enabledByKey = generatedHeaderControlMap(request);

    return GENERATED_HEADERS.map((item) => ({
        key: item.key,
        label: item.label,
        value: inferGeneratedHeaderValue(item.key, request, resolvedVariableValues),
        enabled: enabledByKey.get(item.key) !== false,
        note: item.note,
    }));
}

// Backward-compatible alias while App.tsx migrates to the new name.
export const buildAutoGeneratedHeadersPreview = buildGeneratedHeadersPreview;
