export type ParsedCurlRequest = {
    name: string;
    method: string;
    url: string;
    headers: { name: string; value: string; enabled: boolean }[];
    body?: {
        type: "raw";
        content: string;
    };
    warnings: string[];
};

type TokenizeMode = "unquoted" | "single" | "double";

const NO_VALUE_FLAGS = new Set([
    "-s",
    "--silent",
    "-S",
    "--show-error",
    "-k",
    "--insecure",
    "-L",
    "--location",
    "-v",
    "--verbose",
    "--compressed",
    "--http1.1",
    "--http2",
]);

const FLAGS_WITH_VALUE = new Set([
    "-o",
    "--output",
    "--url",
    "--cookie",
    "-b",
    "--proxy",
    "-x",
    "--cert",
    "--key",
    "--cacert",
    "--resolve",
    "--connect-timeout",
    "--max-time",
    "--user-agent",
    "-A",
    "--referer",
    "-e",
]);

function pushToken(tokens: string[], token: string) {
    if (token.length > 0) {
        tokens.push(token);
    }
}

function tokenizeShellLike(input: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let mode: TokenizeMode = "unquoted";
    let cursor = 0;

    while (cursor < input.length) {
        const ch = input[cursor];
        const next = input[cursor + 1] ?? "";
        const nextNext = input[cursor + 2] ?? "";

        if (mode === "unquoted") {
            if (/\s/.test(ch)) {
                pushToken(tokens, current);
                current = "";
                cursor += 1;
                continue;
            }

            if (ch === "'") {
                mode = "single";
                cursor += 1;
                continue;
            }

            if (ch === "\"") {
                mode = "double";
                cursor += 1;
                continue;
            }

            if (ch === "\\") {
                if (next === "\n") {
                    cursor += 2;
                    continue;
                }
                if (next === "\r" && nextNext === "\n") {
                    cursor += 3;
                    continue;
                }
                if (!next) {
                    throw new Error("Invalid cURL command: trailing escape character.");
                }
                current += next;
                cursor += 2;
                continue;
            }

            current += ch;
            cursor += 1;
            continue;
        }

        if (mode === "single") {
            if (ch === "'") {
                mode = "unquoted";
                cursor += 1;
                continue;
            }

            current += ch;
            cursor += 1;
            continue;
        }

        if (ch === "\"") {
            mode = "unquoted";
            cursor += 1;
            continue;
        }

        if (ch === "\\") {
            if (next === "\n") {
                cursor += 2;
                continue;
            }
            if (next === "\r" && nextNext === "\n") {
                cursor += 3;
                continue;
            }
            if (!next) {
                throw new Error("Invalid cURL command: trailing escape character.");
            }
            if (next === "\"" || next === "\\" || next === "$" || next === "`") {
                current += next;
                cursor += 2;
                continue;
            }
        }

        current += ch;
        cursor += 1;
    }

    if (mode !== "unquoted") {
        throw new Error("Invalid cURL command: unterminated quote.");
    }

    pushToken(tokens, current);
    return tokens;
}

function takeNextOptionValue(tokens: string[], index: number, optionName: string): { value: string; nextIndex: number } {
    const nextIndex = index + 1;
    if (nextIndex >= tokens.length) {
        throw new Error(`Invalid cURL command: missing value for ${optionName}.`);
    }
    return {
        value: tokens[nextIndex],
        nextIndex,
    };
}

function pushWarning(warnings: string[], warning: string) {
    if (!warnings.includes(warning)) {
        warnings.push(warning);
    }
}

function parseHeaderValue(input: string): { name: string; value: string } {
    const separatorIndex = input.indexOf(":");
    if (separatorIndex === -1) {
        return {
            name: input.trim(),
            value: "",
        };
    }

    return {
        name: input.slice(0, separatorIndex).trim(),
        value: input.slice(separatorIndex + 1).trim(),
    };
}

function encodeBase64(value: string): string {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length === 0) return "";

    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let output = "";
    let index = 0;

    while (index < bytes.length) {
        const byte1 = bytes[index];
        const byte2 = index + 1 < bytes.length ? bytes[index + 1] : 0;
        const byte3 = index + 2 < bytes.length ? bytes[index + 2] : 0;

        const triplet = (byte1 << 16) | (byte2 << 8) | byte3;
        output += alphabet[(triplet >> 18) & 0x3f];
        output += alphabet[(triplet >> 12) & 0x3f];
        output += index + 1 < bytes.length ? alphabet[(triplet >> 6) & 0x3f] : "=";
        output += index + 2 < bytes.length ? alphabet[triplet & 0x3f] : "=";
        index += 3;
    }

    return output;
}

function appendQuerySegments(url: string, querySegments: string[]): string {
    if (querySegments.length === 0) return url;

    const separator = !url.includes("?")
        ? "?"
        : url.endsWith("?") || url.endsWith("&")
            ? ""
            : "&";
    return `${url}${separator}${querySegments.join("&")}`;
}

function extractSimpleQuerySegments(dataSegments: string[]): string[] | null {
    const querySegments: string[] = [];

    for (const segment of dataSegments) {
        const entries = segment.split("&").filter((entry) => entry.length > 0);
        for (const entry of entries) {
            if (/[\r\n]/.test(entry)) {
                return null;
            }
            querySegments.push(entry);
        }
    }

    return querySegments;
}

function normalizeMethod(method: string): string {
    return method.trim().toUpperCase();
}

function deriveRequestName(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) return "Imported cURL request";

    try {
        const parsed = new URL(trimmed);
        const segments = parsed.pathname.split("/").filter((entry) => entry.length > 0);
        if (segments.length > 0) {
            return decodeURIComponent(segments[segments.length - 1]);
        }
        return parsed.hostname || "Imported cURL request";
    } catch {
        const withoutQuery = trimmed.split("?")[0].split("#")[0].replace(/\/+$/, "");
        if (withoutQuery.length === 0) {
            return "Imported cURL request";
        }
        const segments = withoutQuery.split("/").filter((entry) => entry.length > 0);
        return segments[segments.length - 1] ?? "Imported cURL request";
    }
}

type ParsedState = {
    url: string | null;
    method: string | null;
    getMode: boolean;
    headers: { name: string; value: string; enabled: boolean }[];
    dataSegments: string[];
    warnings: string[];
};

function applyDataOption(
    optionName: "--data" | "-d" | "--data-raw" | "--data-binary",
    value: string,
    state: ParsedState
) {
    const isFileReference = value.startsWith("@");
    if ((optionName === "--data" || optionName === "-d" || optionName === "--data-binary") && isFileReference) {
        pushWarning(state.warnings, "File-based payloads are not supported and were ignored.");
        return;
    }

    state.dataSegments.push(value);
}

export function parseCurlCommand(input: string): ParsedCurlRequest {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
        throw new Error("cURL input is empty.");
    }

    const tokens = tokenizeShellLike(trimmedInput);
    if (tokens.length === 0) {
        throw new Error("cURL input is empty.");
    }

    let index = tokens[0].toLowerCase() === "curl" ? 1 : 0;
    if (index >= tokens.length) {
        throw new Error("Invalid cURL command: URL is missing.");
    }

    const state: ParsedState = {
        url: null,
        method: null,
        getMode: false,
        headers: [],
        dataSegments: [],
        warnings: [],
    };

    let optionsEnabled = true;

    while (index < tokens.length) {
        const token = tokens[index];

        if (optionsEnabled && token === "--") {
            optionsEnabled = false;
            index += 1;
            continue;
        }

        if (optionsEnabled && (token === "-X" || token === "--request" || token.startsWith("--request=") || token.startsWith("-X"))) {
            let value = "";
            if (token === "-X" || token === "--request") {
                const next = takeNextOptionValue(tokens, index, token);
                value = next.value;
                index = next.nextIndex;
            } else if (token.startsWith("--request=")) {
                value = token.slice("--request=".length);
            } else {
                value = token.slice(2);
            }

            if (!value.trim()) {
                throw new Error("Invalid cURL command: request method is empty.");
            }
            state.method = normalizeMethod(value);
            index += 1;
            continue;
        }

        if (optionsEnabled && (token === "-I" || token === "--head")) {
            state.method = "HEAD";
            index += 1;
            continue;
        }

        if (optionsEnabled && (token === "-G" || token === "--get")) {
            state.getMode = true;
            index += 1;
            continue;
        }

        if (optionsEnabled && (token === "-H" || token === "--header" || token.startsWith("--header=") || token.startsWith("-H"))) {
            let headerValue = "";
            if (token === "-H" || token === "--header") {
                const next = takeNextOptionValue(tokens, index, token);
                headerValue = next.value;
                index = next.nextIndex;
            } else if (token.startsWith("--header=")) {
                headerValue = token.slice("--header=".length);
            } else {
                headerValue = token.slice(2);
            }

            const parsedHeader = parseHeaderValue(headerValue);
            if (parsedHeader.name.length > 0) {
                state.headers.push({
                    name: parsedHeader.name,
                    value: parsedHeader.value,
                    enabled: true,
                });
            }
            index += 1;
            continue;
        }

        if (
            optionsEnabled &&
            (
                token === "-d" ||
                token === "--data" ||
                token === "--data-raw" ||
                token === "--data-binary" ||
                token.startsWith("-d") ||
                token.startsWith("--data=") ||
                token.startsWith("--data-raw=") ||
                token.startsWith("--data-binary=")
            )
        ) {
            let optionName: "--data" | "-d" | "--data-raw" | "--data-binary" = "--data";
            let dataValue = "";

            if (token === "-d" || token === "--data" || token === "--data-raw" || token === "--data-binary") {
                optionName = token as "--data" | "-d" | "--data-raw" | "--data-binary";
                const next = takeNextOptionValue(tokens, index, token);
                dataValue = next.value;
                index = next.nextIndex;
            } else if (token.startsWith("--data=")) {
                optionName = "--data";
                dataValue = token.slice("--data=".length);
            } else if (token.startsWith("--data-raw=")) {
                optionName = "--data-raw";
                dataValue = token.slice("--data-raw=".length);
            } else if (token.startsWith("--data-binary=")) {
                optionName = "--data-binary";
                dataValue = token.slice("--data-binary=".length);
            } else {
                optionName = "-d";
                dataValue = token.slice(2);
            }

            applyDataOption(optionName, dataValue, state);
            index += 1;
            continue;
        }

        if (optionsEnabled && (token === "-u" || token === "--user" || token.startsWith("--user=") || token.startsWith("-u"))) {
            let userValue = "";
            if (token === "-u" || token === "--user") {
                const next = takeNextOptionValue(tokens, index, token);
                userValue = next.value;
                index = next.nextIndex;
            } else if (token.startsWith("--user=")) {
                userValue = token.slice("--user=".length);
            } else {
                userValue = token.slice(2);
            }

            if (userValue.length > 0 && userValue !== ":") {
                const [username, ...passwordParts] = userValue.split(":");
                const password = passwordParts.join(":");
                const encoded = encodeBase64(`${username}:${password}`);
                state.headers.push({
                    name: "Authorization",
                    value: `Basic ${encoded}`,
                    enabled: true,
                });
            } else {
                pushWarning(state.warnings, "Interactive credentials are not supported and were ignored.");
            }
            index += 1;
            continue;
        }

        if (optionsEnabled && (token === "-F" || token === "--form" || token.startsWith("--form=") || token.startsWith("-F"))) {
            pushWarning(state.warnings, "Multipart form data is not supported and was ignored.");
            if (token === "-F" || token === "--form") {
                if (index + 1 < tokens.length) {
                    index += 1;
                }
            }
            index += 1;
            continue;
        }

        if (optionsEnabled && (token === "--url" || token.startsWith("--url="))) {
            if (token === "--url") {
                const next = takeNextOptionValue(tokens, index, token);
                state.url = next.value;
                index = next.nextIndex;
            } else {
                state.url = token.slice("--url=".length);
            }
            index += 1;
            continue;
        }

        if (optionsEnabled && NO_VALUE_FLAGS.has(token)) {
            index += 1;
            continue;
        }

        if (optionsEnabled && FLAGS_WITH_VALUE.has(token)) {
            if (index + 1 < tokens.length) {
                index += 2;
            } else {
                index += 1;
            }
            pushWarning(state.warnings, `Ignored unsupported option: ${token}.`);
            continue;
        }

        if (optionsEnabled && token.startsWith("-") && token !== "-") {
            pushWarning(state.warnings, `Ignored unsupported option: ${token}.`);
            index += 1;
            continue;
        }

        if (!state.url) {
            state.url = token;
        } else {
            pushWarning(state.warnings, `Multiple URLs detected. Using '${state.url}'.`);
        }
        index += 1;
    }

    if (!state.url || state.url.trim().length === 0) {
        throw new Error("Invalid cURL command: URL is missing.");
    }

    let url = state.url.trim();
    let body: ParsedCurlRequest["body"] | undefined;

    if (state.getMode) {
        const querySegments = extractSimpleQuerySegments(state.dataSegments);
        if (querySegments) {
            url = appendQuerySegments(url, querySegments);
        } else if (state.dataSegments.length > 0) {
            pushWarning(state.warnings, "Could not convert complex --get payload into query parameters.");
        }
    } else if (state.dataSegments.length > 0) {
        body = {
            type: "raw",
            content: state.dataSegments.join("&"),
        };
    }

    let method = state.method;
    if (!method) {
        if (state.getMode) {
            method = "GET";
        } else if (body) {
            method = "POST";
        } else {
            method = "GET";
        }
    }

    return {
        name: deriveRequestName(url),
        method,
        url,
        headers: state.headers,
        body,
        warnings: state.warnings,
    };
}
