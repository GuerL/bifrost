type CurlKeyValue = {
    key: string;
    value: string;
    enabled?: boolean;
};

type CurlBodyLike =
    | { type: "none" }
    | { type: "raw"; content_type?: string; text: string }
    | { type: "json"; value: unknown; text?: string }
    | { type: "form"; fields: CurlKeyValue[] };

export type RequestLike = {
    method: string;
    url: string;
    headers?: CurlKeyValue[];
    query?: CurlKeyValue[];
    body?: CurlBodyLike;
};

type BodyBuildResult = {
    hasExplicitBody: boolean;
    data: string | null;
    implicitContentType: string | null;
};

function unsupportedBodyType(body: { type: string }): never {
    throw new Error(`Unsupported body type for cURL export: ${body.type}`);
}

function isEnabled(entry: { enabled?: boolean }): boolean {
    return entry.enabled !== false;
}

function shellSingleQuote(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
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

function buildUrlWithQuery(url: string, query: CurlKeyValue[]): string {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
        throw new Error("Request URL is empty.");
    }

    const activeQuery = query.filter((entry) => {
        if (!isEnabled(entry)) return false;
        return entry.key.trim().length > 0;
    });
    if (activeQuery.length === 0) {
        return trimmedUrl;
    }

    const separator = !trimmedUrl.includes("?")
        ? "?"
        : trimmedUrl.endsWith("?") || trimmedUrl.endsWith("&")
            ? ""
            : "&";
    const queryText = activeQuery.map((entry) => `${entry.key}=${entry.value}`).join("&");
    return `${trimmedUrl}${separator}${queryText}`;
}

function buildBody(body: CurlBodyLike | undefined): BodyBuildResult {
    if (!body || body.type === "none") {
        return {
            hasExplicitBody: false,
            data: null,
            implicitContentType: null,
        };
    }

    if (body.type === "raw") {
        const contentType =
            typeof body.content_type === "string" && body.content_type.trim().length > 0
                ? body.content_type.trim()
                : null;
        return {
            hasExplicitBody: true,
            data: body.text,
            implicitContentType: contentType,
        };
    }

    if (body.type === "json") {
        if (typeof body.text === "string" && body.text.trim().length > 0) {
            return {
                hasExplicitBody: true,
                data: stripJsonComments(body.text),
                implicitContentType: "application/json",
            };
        }

        try {
            const serialized = JSON.stringify(body.value);
            return {
                hasExplicitBody: true,
                data: serialized ?? "null",
                implicitContentType: "application/json",
            };
        } catch (error) {
            throw new Error(
                `Failed to serialize JSON body: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    if (body.type === "form") {
        const activeFields = body.fields.filter((entry) => {
            if (!isEnabled(entry)) return false;
            return entry.key.trim().length > 0;
        });
        return {
            hasExplicitBody: true,
            data: activeFields.map((entry) => `${entry.key}=${entry.value}`).join("&"),
            implicitContentType: "application/x-www-form-urlencoded",
        };
    }

    return unsupportedBodyType(body);
}

export function buildCurlCommand(request: RequestLike): string {
    const method = request.method.trim().toUpperCase();
    if (!method) {
        throw new Error("Request method is empty.");
    }

    const fullUrl = buildUrlWithQuery(request.url, request.query ?? []);
    const body = buildBody(request.body);

    const headers = (request.headers ?? []).filter((entry) => {
        if (!isEnabled(entry)) return false;
        if (entry.key.trim().length === 0) return false;
        return entry.value.trim().length > 0;
    });

    const hasContentTypeHeader = headers.some(
        (entry) => entry.key.trim().toLowerCase() === "content-type"
    );

    if (body.implicitContentType && !hasContentTypeHeader) {
        headers.push({
            key: "Content-Type",
            value: body.implicitContentType,
        });
    }

    const parts: string[] = [`curl -X ${method} ${shellSingleQuote(fullUrl)}`];

    for (const header of headers) {
        parts.push(
            `-H ${shellSingleQuote(`${header.key.trim()}: ${header.value}`)}`
        );
    }

    if (body.data !== null && (method !== "GET" || body.hasExplicitBody)) {
        parts.push(`--data-raw ${shellSingleQuote(body.data)}`);
    }

    if (parts.length === 1) {
        return parts[0];
    }

    return `${parts[0]} \\\n  ${parts.slice(1).join(" \\\n  ")}`;
}
