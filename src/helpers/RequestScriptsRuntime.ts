import type { HttpResponseDto, Request } from "../types.ts";

type ScriptPhase = "pre-request" | "post-response";

type ScriptRunArgs = {
    phase: ScriptPhase;
    script: string;
    request: Request;
    response: HttpResponseDto | null;
    runtimeVariables: Record<string, string>;
    environmentValues: Map<string, string>;
};

export type ScriptEnvironmentMutation =
    | { type: "set"; key: string; value: string }
    | { type: "unset"; key: string };

export type ScriptTestResult = {
    name: string;
    status: "passed" | "failed";
    error: string | null;
};

export type ScriptRunResult = {
    request: Request;
    runtimeVariables: Record<string, string>;
    environmentMutations: ScriptEnvironmentMutation[];
    tests: ScriptTestResult[];
    error: string | null;
};

type AssertableValue<T> = {
    toBe: (expected: unknown) => void;
    toEqual: (expected: unknown) => void;
    toBeTruthy: () => void;
    toBeFalsy: () => void;
    valueOf: () => T;
    toString: () => string;
};

function stringifyError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function cloneRequest(request: Request): Request {
    if (typeof structuredClone === "function") {
        return structuredClone(request);
    }
    return JSON.parse(JSON.stringify(request)) as Request;
}

function createAssertableValue<T>(label: string, actual: T): AssertableValue<T> {
    return {
        toBe: (expected: unknown) => {
            if (!Object.is(actual, expected)) {
                throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
            }
        },
        toEqual: (expected: unknown) => {
            const actualSerialized = JSON.stringify(actual);
            const expectedSerialized = JSON.stringify(expected);
            if (actualSerialized !== expectedSerialized) {
                throw new Error(`${label}: expected ${expectedSerialized}, got ${actualSerialized}`);
            }
        },
        toBeTruthy: () => {
            if (!actual) {
                throw new Error(`${label}: expected truthy, got ${String(actual)}`);
            }
        },
        toBeFalsy: () => {
            if (actual) {
                throw new Error(`${label}: expected falsy, got ${String(actual)}`);
            }
        },
        valueOf: () => actual,
        toString: () => String(actual),
    };
}

function createHeadersApi(headers: { key: string; value: string }[]) {
    return {
        get: (name: string): string | undefined => {
            const target = String(name ?? "").trim().toLowerCase();
            if (!target) return undefined;
            const found = headers.find((entry) => entry.key.toLowerCase() === target);
            return found?.value;
        },
        has: (name: string): boolean => {
            const target = String(name ?? "").trim().toLowerCase();
            if (!target) return false;
            return headers.some((entry) => entry.key.toLowerCase() === target);
        },
        entries: () => headers.map((entry) => ({ ...entry })),
        toObject: () => {
            const out: Record<string, string> = {};
            for (const entry of headers) {
                out[entry.key] = entry.value;
            }
            return out;
        },
    };
}

function createResponseApi(response: HttpResponseDto | null) {
    const noResponseError = (method: string) =>
        new Error(`${method} is not available before a response is received`);

    if (!response) {
        return {
            status: createAssertableValue("response.status", null),
            statusCode: null as number | null,
            headers: createHeadersApi([]),
            body: "",
            text: () => {
                throw noResponseError("pg.response.text()");
            },
            json: () => {
                throw noResponseError("pg.response.json()");
            },
        };
    }

    const headers = createHeadersApi(response.headers);
    let cachedJson: unknown;
    let jsonParsed = false;

    return {
        status: createAssertableValue("response.status", response.status),
        statusCode: response.status,
        headers,
        body: response.body_text,
        text: () => response.body_text,
        json: () => {
            if (jsonParsed) return cachedJson;
            try {
                cachedJson = JSON.parse(response.body_text);
                jsonParsed = true;
                return cachedJson;
            } catch {
                throw new Error("pg.response.json(): response body is not valid JSON");
            }
        },
    };
}

function runScript({
    phase,
    script,
    request,
    response,
    runtimeVariables,
    environmentValues,
}: ScriptRunArgs): ScriptRunResult {
    if (!script.trim()) {
        return {
            request,
            runtimeVariables,
            environmentMutations: [],
            tests: [],
            error: null,
        };
    }

    const mutableRequest = cloneRequest(request);
    const runtime = { ...runtimeVariables };
    const responseApi = createResponseApi(response);
    const environmentMutations: ScriptEnvironmentMutation[] = [];
    const tests: ScriptTestResult[] = [];

    const environmentApi = {
        get: (name: string): string | undefined => {
            const key = String(name ?? "").trim();
            if (!key) return undefined;
            if (Object.prototype.hasOwnProperty.call(runtime, key)) {
                return runtime[key];
            }
            return environmentValues.get(key);
        },
        set: (name: string, value: unknown) => {
            const key = String(name ?? "").trim();
            if (!key) return;
            const nextValue = String(value ?? "");
            runtime[key] = nextValue;
            environmentMutations.push({ type: "set", key, value: nextValue });
        },
        unset: (name: string) => {
            const key = String(name ?? "").trim();
            if (!key) return;
            delete runtime[key];
            environmentMutations.push({ type: "unset", key });
        },
        toObject: () => ({ ...runtime }),
    };

    const collectionVariablesApi = {
        get: (name: string): string | undefined => {
            const key = String(name ?? "").trim();
            if (!key) return undefined;
            return runtime[key];
        },
        set: (name: string, value: unknown) => {
            const key = String(name ?? "").trim();
            if (!key) return;
            runtime[key] = String(value ?? "");
        },
        unset: (name: string) => {
            const key = String(name ?? "").trim();
            if (!key) return;
            delete runtime[key];
        },
        toObject: () => ({ ...runtime }),
    };

    const pg = {
        environment: environmentApi,
        collectionVariables: collectionVariablesApi,
        globals: collectionVariablesApi,
        request: mutableRequest,
        response: responseApi,
        expect: (actual: unknown) => createAssertableValue("expect()", actual),
        test: (name: string, callback: () => void) => {
            const normalizedName = String(name ?? "").trim() || "Unnamed test";
            try {
                callback();
                tests.push({ name: normalizedName, status: "passed", error: null });
            } catch (error) {
                tests.push({
                    name: normalizedName,
                    status: "failed",
                    error: stringifyError(error),
                });
            }
        },
    };

    const normalizedScript = script
        .replace(/[“”]/g, "\"")
        .replace(/[‘’]/g, "'");

    try {
        const fn = new Function("pg", `"use strict";\n${normalizedScript}`);
        fn(pg);
        return {
            request: mutableRequest,
            runtimeVariables: runtime,
            environmentMutations,
            tests,
            error: null,
        };
    } catch (error) {
        return {
            request: mutableRequest,
            runtimeVariables: runtime,
            environmentMutations,
            tests,
            error: `[${phase}] ${stringifyError(error)}`,
        };
    }
}

export function runPreRequestScript(args: Omit<ScriptRunArgs, "phase" | "response">): ScriptRunResult {
    return runScript({
        phase: "pre-request",
        script: args.script,
        request: args.request,
        response: null,
        runtimeVariables: args.runtimeVariables,
        environmentValues: args.environmentValues,
    });
}

export function runPostResponseScript(args: Omit<ScriptRunArgs, "phase">): ScriptRunResult {
    return runScript({
        phase: "post-response",
        script: args.script,
        request: args.request,
        response: args.response,
        runtimeVariables: args.runtimeVariables,
        environmentValues: args.environmentValues,
    });
}
