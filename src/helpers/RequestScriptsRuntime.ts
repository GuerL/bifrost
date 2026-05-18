import type { HttpResponseDto, Request } from "../types.ts";
import {
    createScriptAssertableValue,
    createScriptExpect,
    createScriptTestCollector,
    stringifyScriptError,
    type ScriptAssertableValue,
    type ScriptExpectation,
    type ScriptTestResult,
} from "./scriptAssertions.ts";
export type { ScriptTestResult } from "./scriptAssertions.ts";

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

export type ScriptExecutionResult = {
    request: Request;
    runtimeVariables: Record<string, string>;
    environmentMutations: ScriptEnvironmentMutation[];
    tests: ScriptTestResult[];
    scriptError: string | null;
    // Backward-compatible alias
    error: string | null;
};

export type ScriptRunResult = ScriptExecutionResult;

type ScriptVariableApiBase = {
    get: (name: string) => string | undefined;
    set: (name: string, value: unknown) => void;
    unset: (name: string) => void;
    toObject: () => Record<string, string>;
};

type ScriptRuntimeVariableApi = ScriptVariableApiBase & {
    clear: () => void;
};

type ScriptEnvironmentVariableApi = ScriptVariableApiBase;

type ScriptResponseApi = {
    status: ScriptAssertableValue<number | null>;
    statusCode: number | null;
    headers: ReturnType<typeof createHeadersApi>;
    body: string;
    text: () => string;
    json: () => unknown;
};

export type BifrostRuntimeAPI = {
    runtime: ScriptRuntimeVariableApi;
    env: ScriptEnvironmentVariableApi;
    environment: ScriptEnvironmentVariableApi;
    collectionVariables: ScriptRuntimeVariableApi;
    globals: ScriptRuntimeVariableApi;
    request: Request;
    response: ScriptResponseApi;
    expect: (actual: unknown) => ScriptExpectation;
    test: (name: string, callback: () => void) => void;
};

function cloneRequest(request: Request): Request {
    if (typeof structuredClone === "function") {
        return structuredClone(request);
    }
    return JSON.parse(JSON.stringify(request)) as Request;
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
            status: createScriptAssertableValue(null),
            statusCode: null as number | null,
            headers: createHeadersApi([]),
            body: "",
            text: () => {
                throw noResponseError("bf.response.text()");
            },
            json: () => {
                throw noResponseError("bf.response.json()");
            },
        };
    }

    const headers = createHeadersApi(response.headers);
    let cachedJson: unknown;
    let jsonParsed = false;

    return {
        status: createScriptAssertableValue(response.status),
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
                throw new Error("bf.response.json(): response body is not valid JSON");
            }
        },
    } satisfies ScriptResponseApi;
}

function runScript({
    phase,
    script,
    request,
    response,
    runtimeVariables,
    environmentValues,
}: ScriptRunArgs): ScriptExecutionResult {
    if (!script.trim()) {
        return {
            request,
            runtimeVariables,
            environmentMutations: [],
            tests: [],
            scriptError: null,
            error: null,
        };
    }

    const mutableRequest = cloneRequest(request);
    const runtime = { ...runtimeVariables };
    const responseApi = createResponseApi(response);
    const environmentMutations: ScriptEnvironmentMutation[] = [];
    const testsCollector = createScriptTestCollector();

    const envApi: ScriptEnvironmentVariableApi = {
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

    const runtimeApi: ScriptRuntimeVariableApi = {
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
        clear: () => {
            for (const key of Object.keys(runtime)) {
                delete runtime[key];
            }
        },
        toObject: () => ({ ...runtime }),
    };

    const scriptingApi: BifrostRuntimeAPI = {
        runtime: runtimeApi,
        env: envApi,
        // Backward-compatible aliases.
        environment: envApi,
        collectionVariables: runtimeApi,
        globals: runtimeApi,
        request: mutableRequest,
        response: responseApi,
        expect: (actual: unknown) => createScriptExpect(actual),
        test: testsCollector.test,
    };

    const bf = scriptingApi;
    const pg = scriptingApi;

    const normalizedScript = script
        .replace(/[“”]/g, "\"")
        .replace(/[‘’]/g, "'");

    try {
        const fn = new Function("bf", "pg", `"use strict";\n${normalizedScript}`);
        fn(bf, pg);
        const tests = testsCollector.getResults();
        return {
            request: mutableRequest,
            runtimeVariables: runtime,
            environmentMutations,
            tests,
            scriptError: null,
            error: null,
        };
    } catch (error) {
        const tests = testsCollector.getResults();
        const scriptError = `[${phase}] ${stringifyScriptError(error)}`;
        return {
            request: mutableRequest,
            runtimeVariables: runtime,
            environmentMutations,
            tests,
            scriptError,
            error: scriptError,
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
