import type { Request } from "../types.ts";

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

function normalizeJsonTemplatePlaceholders(input: string): string {
    let out = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        const next = input[i + 1] ?? "";

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

        if (ch === "{" && next === "{") {
            i += 2;
            while (i < input.length) {
                if (input[i] === "}" && (input[i + 1] ?? "") === "}") {
                    i += 1;
                    break;
                }
                i += 1;
            }
            out += "0";
            continue;
        }

        out += ch;
    }

    return out;
}

export function validateStrictJsonBodyForSend(request: Request): string | null {
    if (request.body.type !== "json") return null;

    const text = request.body.text ?? "";
    if (!text.trim()) return null;

    try {
        const stripped = stripJsonComments(text);
        const normalized = normalizeJsonTemplatePlaceholders(stripped);
        JSON.parse(normalized.trim());
        return null;
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return `Invalid JSON body. Trailing commas are not allowed. Fix the JSON and try again. (${detail})`;
    }
}
