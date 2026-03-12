import type { HttpResponseDto } from "../types.ts";
import type { RunnerExecutionPlanItem, RunnerExecutionResult, RunnerResponseSnapshot } from "./types.ts";

const MAX_RESPONSE_BODY_CHARS = 24_000;

export type ParsedRunnerHttpError = {
    code: string;
    message: string;
    durationMs: number | null;
};

export function parseRunnerHttpError(error: unknown): ParsedRunnerHttpError {
    const source = error as {
        kind?: unknown;
        message?: unknown;
        duration_ms?: unknown;
    };

    return {
        code: typeof source?.kind === "string" ? source.kind : "unknown",
        message: typeof source?.message === "string" ? source.message : String(error),
        durationMs: typeof source?.duration_ms === "number" ? source.duration_ms : null,
    };
}

export function createQueuedExecutionResult(
    runId: string,
    planItem: RunnerExecutionPlanItem
): RunnerExecutionResult {
    return {
        executionId: `${runId}:${planItem.planIndex}`,
        ...planItem,
        status: "queued",
        statusText: "Queued",
        wasSent: false,
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        httpStatus: null,
        errorCode: null,
        errorMessage: null,
        response: null,
        extractedVariables: [],
        extractionErrors: [],
        preRequestScriptError: null,
        postResponseScriptError: null,
        preRequestScriptTests: [],
        postResponseScriptTests: [],
    };
}

export function toResponseSnapshot(response: HttpResponseDto): RunnerResponseSnapshot {
    const bodyText = response.body_text ?? "";
    const bodyTruncated = bodyText.length > MAX_RESPONSE_BODY_CHARS;
    return {
        status: response.status,
        headers: response.headers,
        bodyText: bodyTruncated ? bodyText.slice(0, MAX_RESPONSE_BODY_CHARS) : bodyText,
        bodyTruncated,
        durationMs: response.duration_ms,
    };
}
