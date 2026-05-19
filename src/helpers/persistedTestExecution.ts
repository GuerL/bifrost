import type { ScriptTestResult } from "./RequestScriptsRuntime.ts";

export type PersistedTestResult = {
    name: string;
    status: "passed" | "failed";
    error: string | null;
    line?: number;
    column?: number;
    durationMs?: number;
    scriptPhase?: "pre-request" | "post-response";
};

export type PersistedTestExecutionSummary = {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
};

export type PersistedTestExecution = {
    preRequestError: string | null;
    postResponseError: string | null;
    summary: PersistedTestExecutionSummary;
    tests: PersistedTestResult[];
};

type ScriptReportLike = {
    preRequestError: string | null;
    postResponseError: string | null;
    tests: ScriptTestResult[];
};

function asNonNegativeInteger(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (value < 0) return null;
    return Math.floor(value);
}

function sanitizeOptionalNonNegativeInteger(value: unknown): number | undefined {
    const normalized = asNonNegativeInteger(value);
    return normalized == null ? undefined : normalized;
}

function sanitizeOptionalPhase(value: unknown): "pre-request" | "post-response" | undefined {
    if (value === "pre-request" || value === "post-response") {
        return value;
    }
    return undefined;
}

export function summarizeTests(
    tests: Array<{ status: "passed" | "failed" }>,
    skippedCount = 0
): PersistedTestExecutionSummary {
    const passed = tests.filter((test) => test.status === "passed").length;
    const failed = tests.length - passed;
    const skipped = Math.max(0, Math.floor(skippedCount));
    return {
        total: tests.length + skipped,
        passed,
        failed,
        skipped,
    };
}

export function createPersistedTestExecution(report: ScriptReportLike): PersistedTestExecution {
    const tests: PersistedTestResult[] = report.tests.map((test) => ({
        name: test.name,
        status: test.status,
        error: test.error,
        ...(typeof test.line === "number" ? { line: Math.max(1, Math.floor(test.line)) } : {}),
        ...(typeof test.column === "number" ? { column: Math.max(1, Math.floor(test.column)) } : {}),
        ...(typeof test.durationMs === "number" ? { durationMs: Math.max(0, Math.floor(test.durationMs)) } : {}),
        ...(test.scriptPhase ? { scriptPhase: test.scriptPhase } : {}),
    }));

    return {
        preRequestError: report.preRequestError,
        postResponseError: report.postResponseError,
        summary: summarizeTests(tests),
        tests,
    };
}

function sanitizePersistedTestResult(input: unknown): PersistedTestResult | null {
    if (!input || typeof input !== "object") return null;
    const source = input as Record<string, unknown>;
    if (typeof source.name !== "string") return null;
    if (source.status !== "passed" && source.status !== "failed") return null;

    const error = source.error == null ? null : typeof source.error === "string" ? source.error : null;

    return {
        name: source.name,
        status: source.status,
        error,
        ...(sanitizeOptionalNonNegativeInteger(source.line) != null
            ? { line: Math.max(1, sanitizeOptionalNonNegativeInteger(source.line) as number) }
            : {}),
        ...(sanitizeOptionalNonNegativeInteger(source.column) != null
            ? { column: Math.max(1, sanitizeOptionalNonNegativeInteger(source.column) as number) }
            : {}),
        ...(sanitizeOptionalNonNegativeInteger(source.durationMs) != null
            ? { durationMs: sanitizeOptionalNonNegativeInteger(source.durationMs) }
            : {}),
        ...(sanitizeOptionalPhase(source.scriptPhase) ? { scriptPhase: sanitizeOptionalPhase(source.scriptPhase) } : {}),
    };
}

export function sanitizePersistedTestExecution(input: unknown): PersistedTestExecution | null {
    if (!input || typeof input !== "object") return null;
    const source = input as Record<string, unknown>;
    if (!Array.isArray(source.tests)) return null;

    const tests = source.tests
        .map((entry) => sanitizePersistedTestResult(entry))
        .filter((entry): entry is PersistedTestResult => entry !== null);

    const summaryInput =
        source.summary && typeof source.summary === "object"
            ? (source.summary as Record<string, unknown>)
            : null;

    const summarySkipped = summaryInput ? asNonNegativeInteger(summaryInput.skipped) ?? 0 : 0;
    const summary = summarizeTests(tests, summarySkipped);

    return {
        preRequestError:
            source.preRequestError == null
                ? null
                : typeof source.preRequestError === "string"
                  ? source.preRequestError
                  : null,
        postResponseError:
            source.postResponseError == null
                ? null
                : typeof source.postResponseError === "string"
                  ? source.postResponseError
                  : null,
        summary,
        tests,
    };
}

export function normalizeStatusTextWithTestExecution(
    statusText: string,
    execution: PersistedTestExecution | null
): string {
    const cleaned = statusText.replace(/\s• tests \d+\/\d+/g, "");
    if (!execution || execution.summary.total === 0) {
        return cleaned;
    }
    return `${cleaned} • tests ${execution.summary.passed}/${execution.summary.total}`;
}
