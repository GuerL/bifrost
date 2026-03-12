import type { HttpResponseDto, KeyValue, Request, ResponseExtractorRule } from "../types.ts";

export type ExtractedVariablesResult = {
    extracted: KeyValue[];
    errors: string[];
};

function readJsonPathValue(source: unknown, path: string): unknown {
    const trimmed = path.trim();
    if (!trimmed) return undefined;

    const tokens: Array<string | number> = [];
    const tokenPattern = /([^[.\]]+)|\[(\d+)\]/g;
    let token: RegExpExecArray | null;

    while ((token = tokenPattern.exec(trimmed)) !== null) {
        if (token[1]) {
            tokens.push(token[1]);
            continue;
        }
        if (token[2]) {
            tokens.push(Number.parseInt(token[2], 10));
        }
    }

    if (tokens.length === 0) return undefined;

    let current: unknown = source;
    for (const part of tokens) {
        if (typeof part === "number") {
            if (!Array.isArray(current) || part < 0 || part >= current.length) return undefined;
            current = current[part];
            continue;
        }

        if (!current || typeof current !== "object") return undefined;
        current = (current as Record<string, unknown>)[part];
    }

    return current;
}

function toExtractedString(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }

    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
}

function extractFromHeader(rule: Extract<ResponseExtractorRule, { from: "header" }>, response: HttpResponseDto): string | null {
    const headerName = rule.header.trim().toLowerCase();
    if (!headerName) return null;

    const match = response.headers.find((header) => header.key.toLowerCase() === headerName);
    if (!match) return null;
    return match.value;
}

function extractFromJsonBody(
    rule: Extract<ResponseExtractorRule, { from: "json_body" }>,
    parsedBody: { value: unknown | null; invalid: boolean }
): string | null {
    if (parsedBody.invalid) return null;
    const value = readJsonPathValue(parsedBody.value, rule.path);
    return toExtractedString(value);
}

export function extractVariablesFromResponse(
    request: Request,
    response: HttpResponseDto
): ExtractedVariablesResult {
    if (!request.extractors.length) {
        return { extracted: [], errors: [] };
    }

    const extractedMap = new Map<string, string>();
    const errors: string[] = [];
    const parsedBody: { value: unknown | null; invalid: boolean } = { value: null, invalid: false };
    let bodyChecked = false;

    for (const rule of request.extractors) {
        const variable = rule.variable.trim();
        if (!variable) {
            errors.push("Extractor has an empty variable name.");
            continue;
        }

        let value: string | null = null;

        if (rule.from === "header") {
            value = extractFromHeader(rule, response);
            if (value === null) {
                errors.push(`Extractor "${variable}" could not find header "${rule.header}".`);
            }
        } else if (rule.from === "json_body") {
            if (!bodyChecked) {
                bodyChecked = true;
                try {
                    parsedBody.value = JSON.parse(response.body_text);
                } catch {
                    parsedBody.invalid = true;
                }
            }

            if (parsedBody.invalid) {
                errors.push(`Extractor "${variable}" expected JSON body but response body is not valid JSON.`);
                continue;
            }

            value = extractFromJsonBody(rule, parsedBody);
            if (value === null) {
                errors.push(`Extractor "${variable}" could not resolve JSON path "${rule.path}".`);
            }
        }

        if (value === null) continue;
        extractedMap.set(variable, value);
    }

    const extracted = Array.from(extractedMap.entries()).map(([key, value]) => ({
        key,
        value,
    }));

    return { extracted, errors };
}

export function mergeExtractedVariables(
    base: Record<string, string>,
    extracted: KeyValue[]
): Record<string, string> {
    if (!extracted.length) return base;
    const next = { ...base };
    for (const entry of extracted) {
        if (!entry.key.trim()) continue;
        next[entry.key] = entry.value;
    }
    return next;
}
