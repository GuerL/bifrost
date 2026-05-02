import type { Request } from "../types.ts";

export const PG_TO_BF_PROMPTED_STORAGE_KEY = "bifrost.migrations.pgToBfPrompted";

type ScriptField = string;
type TokenType = "start" | "identifier" | "keyword" | "number" | "string" | "regex" | "punctuation";

type CodeContext = {
    kind: "code";
    templateExpressionDepth: number | null;
    lastTokenType: TokenType;
    lastTokenValue: string;
};

type ScannerContext =
    | CodeContext
    | { kind: "single_quote" }
    | { kind: "double_quote" }
    | { kind: "template" }
    | { kind: "line_comment" }
    | { kind: "block_comment" }
    | { kind: "regex"; inCharacterClass: boolean };

export type LegacyScriptLocation = {
    requestId: string;
    scriptField: ScriptField;
};

export type ScriptMigrationResult = {
    script: string;
    changed: boolean;
    legacyUsageDetected: boolean;
};

export type PgToBfPromptDecisionInput = {
    promptedFlag: boolean;
    legacyScriptCount: number;
};

export type PgToBfPromptDecision = {
    shouldShowPrompt: boolean;
    reason: "already_prompted" | "no_legacy_scripts" | "legacy_scripts_detected";
};

type StorageLike = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem?: (key: string) => void;
};

const REGEX_PRECEDING_PUNCTUATION = new Set([
    "(",
    "[",
    "{",
    ",",
    ";",
    ":",
    "?",
    "=",
    "==",
    "===",
    "!=",
    "!==",
    "+",
    "-",
    "*",
    "%",
    "&",
    "&&",
    "|",
    "||",
    "^",
    "~",
    "!",
    "<",
    ">",
    "<=",
    ">=",
    "=>",
]);

const REGEX_PRECEDING_KEYWORDS = new Set([
    "return",
    "throw",
    "case",
    "delete",
    "typeof",
    "void",
    "new",
    "in",
    "instanceof",
    "yield",
    "await",
]);

function isIdentifierStart(char: string): boolean {
    return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
    return /[A-Za-z0-9_$]/.test(char);
}

function isDigit(char: string): boolean {
    return /[0-9]/.test(char);
}

function isWhitespace(char: string): boolean {
    return /\s/.test(char);
}

function getBrowserStorage(): StorageLike | null {
    if (typeof window === "undefined") return null;
    return window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

type RequestScriptEntry = {
    field: string;
    script: string;
};

export function listRequestScriptFields(request: Request): string[] {
    if (!isRecord(request.scripts)) {
        return [];
    }
    return Object.entries(request.scripts)
        .filter(([, value]) => typeof value === "string")
        .map(([field]) => field);
}

function listRequestScriptEntries(request: Request): RequestScriptEntry[] {
    if (!isRecord(request.scripts)) {
        return [];
    }
    return Object.entries(request.scripts)
        .filter(([, value]) => typeof value === "string")
        .map(([field, script]) => ({ field, script: script as string }));
}

function canStartRegex(codeContext: CodeContext): boolean {
    if (codeContext.lastTokenType === "start") return true;
    if (codeContext.lastTokenType === "keyword") {
        return REGEX_PRECEDING_KEYWORDS.has(codeContext.lastTokenValue);
    }
    if (codeContext.lastTokenType === "punctuation") {
        return REGEX_PRECEDING_PUNCTUATION.has(codeContext.lastTokenValue);
    }
    return false;
}

function parsePunctuation(script: string, index: number): { token: string; nextIndex: number } {
    const three = script.slice(index, index + 3);
    const two = script.slice(index, index + 2);

    const punctuators3 = new Set(["===", "!==", ">>>", "<<=", ">>=", "&&=", "||=", "??="]);
    const punctuators2 = new Set([
        "=>",
        "==",
        "!=",
        "<=",
        ">=",
        "&&",
        "||",
        "??",
        "++",
        "--",
        "+=",
        "-=",
        "*=",
        "/=",
        "%=",
        "&=",
        "|=",
        "^=",
        "<<",
        ">>",
        "**",
        "?.",
    ]);

    if (punctuators3.has(three)) {
        return { token: three, nextIndex: index + 3 };
    }
    if (punctuators2.has(two)) {
        return { token: two, nextIndex: index + 2 };
    }
    return { token: script[index], nextIndex: index + 1 };
}

function transformLegacyPrefix(script: string, replace: boolean): ScriptMigrationResult {
    if (!script) {
        return { script, changed: false, legacyUsageDetected: false };
    }

    let index = 0;
    let output = "";
    let changed = false;
    let legacyUsageDetected = false;

    const stack: ScannerContext[] = [
        {
            kind: "code",
            templateExpressionDepth: null,
            lastTokenType: "start",
            lastTokenValue: "",
        },
    ];

    while (index < script.length) {
        const context = stack[stack.length - 1];
        const char = script[index];
        const next = script[index + 1] ?? "";

        if (context.kind === "line_comment") {
            output += char;
            index += 1;
            if (char === "\n") {
                stack.pop();
            }
            continue;
        }

        if (context.kind === "block_comment") {
            output += char;
            index += 1;
            if (char === "*" && next === "/") {
                output += "/";
                index += 1;
                stack.pop();
            }
            continue;
        }

        if (context.kind === "single_quote") {
            output += char;
            index += 1;
            if (char === "\\") {
                if (index < script.length) {
                    output += script[index];
                    index += 1;
                }
                continue;
            }
            if (char === "'") {
                stack.pop();
            }
            continue;
        }

        if (context.kind === "double_quote") {
            output += char;
            index += 1;
            if (char === "\\") {
                if (index < script.length) {
                    output += script[index];
                    index += 1;
                }
                continue;
            }
            if (char === "\"") {
                stack.pop();
            }
            continue;
        }

        if (context.kind === "template") {
            output += char;
            index += 1;

            if (char === "\\") {
                if (index < script.length) {
                    output += script[index];
                    index += 1;
                }
                continue;
            }

            if (char === "`") {
                stack.pop();
                continue;
            }

            if (char === "$" && next === "{") {
                output += "{";
                index += 1;
                stack.push({
                    kind: "code",
                    templateExpressionDepth: 1,
                    lastTokenType: "start",
                    lastTokenValue: "",
                });
            }
            continue;
        }

        if (context.kind === "regex") {
            output += char;
            index += 1;

            if (char === "\\") {
                if (index < script.length) {
                    output += script[index];
                    index += 1;
                }
                continue;
            }

            if (char === "[" && !context.inCharacterClass) {
                context.inCharacterClass = true;
                continue;
            }

            if (char === "]" && context.inCharacterClass) {
                context.inCharacterClass = false;
                continue;
            }

            if (char === "/" && !context.inCharacterClass) {
                while (index < script.length && /[a-z]/i.test(script[index])) {
                    output += script[index];
                    index += 1;
                }
                stack.pop();
            }
            continue;
        }

        if (context.templateExpressionDepth !== null) {
            if (char === "{") {
                output += char;
                index += 1;
                context.templateExpressionDepth += 1;
                context.lastTokenType = "punctuation";
                context.lastTokenValue = "{";
                continue;
            }

            if (char === "}") {
                output += char;
                index += 1;
                context.templateExpressionDepth -= 1;
                context.lastTokenType = "punctuation";
                context.lastTokenValue = "}";
                if (context.templateExpressionDepth === 0) {
                    stack.pop();
                }
                continue;
            }
        }

        if (isWhitespace(char)) {
            output += char;
            index += 1;
            continue;
        }

        if (char === "/" && next === "/") {
            output += "//";
            index += 2;
            stack.push({ kind: "line_comment" });
            continue;
        }

        if (char === "/" && next === "*") {
            output += "/*";
            index += 2;
            stack.push({ kind: "block_comment" });
            continue;
        }

        if (char === "'" || char === "\"" || char === "`") {
            output += char;
            index += 1;
            context.lastTokenType = "string";
            context.lastTokenValue = char;
            if (char === "'") {
                stack.push({ kind: "single_quote" });
                continue;
            }
            if (char === "\"") {
                stack.push({ kind: "double_quote" });
                continue;
            }
            stack.push({ kind: "template" });
            continue;
        }

        if (char === "/" && canStartRegex(context)) {
            output += char;
            index += 1;
            context.lastTokenType = "regex";
            context.lastTokenValue = "/";
            stack.push({ kind: "regex", inCharacterClass: false });
            continue;
        }

        if (isIdentifierStart(char)) {
            let end = index + 1;
            while (end < script.length && isIdentifierPart(script[end])) {
                end += 1;
            }
            const identifier = script.slice(index, end);
            const hasLegacyMemberAccess = identifier === "pg" && script[end] === ".";
            if (hasLegacyMemberAccess) {
                legacyUsageDetected = true;
            }

            if (replace && hasLegacyMemberAccess) {
                output += "bf";
                changed = true;
            } else {
                output += identifier;
            }

            index = end;
            if (REGEX_PRECEDING_KEYWORDS.has(identifier)) {
                context.lastTokenType = "keyword";
                context.lastTokenValue = identifier;
            } else {
                context.lastTokenType = "identifier";
                context.lastTokenValue = identifier;
            }
            continue;
        }

        if (isDigit(char)) {
            let end = index + 1;
            while (end < script.length && /[0-9._a-fA-FxXoObBnNeE+-]/.test(script[end])) {
                end += 1;
            }
            output += script.slice(index, end);
            index = end;
            context.lastTokenType = "number";
            context.lastTokenValue = "number";
            continue;
        }

        const { token, nextIndex } = parsePunctuation(script, index);
        output += token;
        index = nextIndex;
        context.lastTokenType = "punctuation";
        context.lastTokenValue = token;
    }

    return {
        script: output,
        changed,
        legacyUsageDetected,
    };
}

export function scriptContainsLegacyPgPrefix(script: string): boolean {
    return transformLegacyPrefix(script, false).legacyUsageDetected;
}

export function migrateScriptFromPgToBf(script: string): ScriptMigrationResult {
    return transformLegacyPrefix(script, true);
}

export function findLegacyPgScriptLocations(requests: Request[]): LegacyScriptLocation[] {
    const locations: LegacyScriptLocation[] = [];

    for (const request of requests) {
        const scriptEntries = listRequestScriptEntries(request);
        for (const entry of scriptEntries) {
            if (!scriptContainsLegacyPgPrefix(entry.script)) continue;
            locations.push({ requestId: request.id, scriptField: entry.field });
        }
    }

    return locations;
}

export function migrateRequestScriptsFromPgToBf(
    request: Request
): { request: Request; changed: boolean } {
    if (!isRecord(request.scripts)) {
        return { request, changed: false };
    }

    const nextScripts: Record<string, unknown> = { ...request.scripts };
    let changed = false;

    for (const [field, value] of Object.entries(request.scripts)) {
        if (typeof value !== "string") continue;
        const migration = migrateScriptFromPgToBf(value);
        if (!migration.changed) continue;
        changed = true;
        nextScripts[field] = migration.script;
    }

    if (!changed) {
        return { request, changed: false };
    }

    return {
        changed: true,
        request: {
            ...request,
            scripts: nextScripts as Request["scripts"],
        },
    };
}

export function decidePgToBfPrompt({
    promptedFlag,
    legacyScriptCount,
}: PgToBfPromptDecisionInput): PgToBfPromptDecision {
    if (promptedFlag) {
        return {
            shouldShowPrompt: false,
            reason: "already_prompted",
        };
    }

    if (legacyScriptCount <= 0) {
        return {
            shouldShowPrompt: false,
            reason: "no_legacy_scripts",
        };
    }

    return {
        shouldShowPrompt: true,
        reason: "legacy_scripts_detected",
    };
}

export function readPgToBfPromptedFlag(storage: StorageLike | null = getBrowserStorage()): boolean {
    if (!storage) return false;
    try {
        const value = storage.getItem(PG_TO_BF_PROMPTED_STORAGE_KEY);
        return value === "1" || value === "true";
    } catch {
        return false;
    }
}

export function writePgToBfPromptedFlag(
    prompted: boolean,
    storage: StorageLike | null = getBrowserStorage()
) {
    if (!storage) return;
    try {
        if (prompted) {
            storage.setItem(PG_TO_BF_PROMPTED_STORAGE_KEY, "1");
            return;
        }
        if (typeof storage.removeItem === "function") {
            storage.removeItem(PG_TO_BF_PROMPTED_STORAGE_KEY);
            return;
        }
        storage.setItem(PG_TO_BF_PROMPTED_STORAGE_KEY, "0");
    } catch {
        // ignore storage write failures
    }
}
