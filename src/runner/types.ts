import type { Request } from "../types.ts";

export type RunnerIterationMode = "request_iteration" | "collection_iteration";

export type RunnerRunStatus = "running" | "completed" | "failed" | "cancelled";

export type RunnerExecutionStatus =
    | "queued"
    | "running"
    | "success"
    | "failed"
    | "cancelled"
    | "skipped";

export type RunnerExecutionPlanItem = {
    planIndex: number;
    requestId: string;
    requestName: string;
    requestMethod: Request["method"];
    iterationMode: RunnerIterationMode;
    requestIterationIndex: number;
    collectionIterationIndex: number | null;
};

export type RunnerResponseSnapshot = {
    status: number;
    headers: { key: string; value: string }[];
    bodyText: string | null;
    bodyTruncated: boolean;
    durationMs: number;
};

export type RunnerScriptTestResult = {
    name: string;
    status: "passed" | "failed";
    error: string | null;
};

export type RunnerExecutionResult = RunnerExecutionPlanItem & {
    executionId: string;
    status: RunnerExecutionStatus;
    statusText: string;
    wasSent: boolean;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    httpStatus: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    response: RunnerResponseSnapshot | null;
    extractedVariables: { key: string; value: string }[];
    extractionErrors: string[];
    preRequestScriptError: string | null;
    postResponseScriptError: string | null;
    preRequestScriptTests: RunnerScriptTestResult[];
    postResponseScriptTests: RunnerScriptTestResult[];
};

export type RunnerRunSummary = {
    total: number;
    queued: number;
    running: number;
    success: number;
    failed: number;
    cancelled: number;
    skipped: number;
    wasCancelledByUser: boolean;
    totalDurationMs: number;
    averageDurationMs: number | null;
};

export type RunnerRun = {
    runId: string;
    collectionId: string;
    collectionName: string;
    mode: RunnerIterationMode;
    iterations: number;
    stopOnFirstFailure: boolean;
    selectedRequestIds: string[];
    startedAt: string;
    finishedAt: string | null;
    status: RunnerRunStatus;
    plan: RunnerExecutionPlanItem[];
    executions: RunnerExecutionResult[];
    summary: RunnerRunSummary;
};

export type RunnerRequestAverage = {
    requestId: string;
    requestName: string;
    requestMethod: Request["method"];
    executionCount: number;
    averageDurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
};

export type RunnerCollectionIterationTotal = {
    collectionIterationIndex: number;
    executionCount: number;
    totalDurationMs: number;
};

export type RunnerAverages = {
    mode: RunnerIterationMode;
    totalDurationMs: number;
    requestAverages: RunnerRequestAverage[];
    collectionIterationTotals: RunnerCollectionIterationTotal[];
    averageCollectionIterationDurationMs: number | null;
};
