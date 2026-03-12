import type {
    RunnerAverages,
    RunnerCollectionIterationTotal,
    RunnerExecutionResult,
    RunnerRun,
    RunnerRunSummary,
} from "./types.ts";

export function summarizeRunnerExecutions(
    executions: RunnerExecutionResult[],
    wasCancelledByUser: boolean
): RunnerRunSummary {
    let queued = 0;
    let running = 0;
    let success = 0;
    let failed = 0;
    let cancelled = 0;
    let skipped = 0;
    let totalDurationMs = 0;
    let durationCount = 0;

    for (const execution of executions) {
        if (execution.status === "queued") queued += 1;
        if (execution.status === "running") running += 1;
        if (execution.status === "success") success += 1;
        if (execution.status === "failed") failed += 1;
        if (execution.status === "cancelled") cancelled += 1;
        if (execution.status === "skipped") skipped += 1;

        if (typeof execution.durationMs === "number" && execution.durationMs >= 0) {
            totalDurationMs += execution.durationMs;
            durationCount += 1;
        }
    }

    return {
        total: executions.length,
        queued,
        running,
        success,
        failed,
        cancelled,
        skipped,
        wasCancelledByUser,
        totalDurationMs,
        averageDurationMs: durationCount > 0 ? totalDurationMs / durationCount : null,
    };
}

export function calculateRunnerAverages(run: RunnerRun): RunnerAverages {
    const sentWithDuration = run.executions.filter(
        (execution) => execution.wasSent && typeof execution.durationMs === "number" && execution.durationMs >= 0
    );

    let totalDurationMs = 0;
    for (const execution of sentWithDuration) {
        totalDurationMs += execution.durationMs as number;
    }

    const requestGroupMap = new Map<
        string,
        { requestName: string; requestMethod: RunnerExecutionResult["requestMethod"]; durations: number[] }
    >();
    for (const execution of sentWithDuration) {
        const current = requestGroupMap.get(execution.requestId) ?? {
            requestName: execution.requestName,
            requestMethod: execution.requestMethod,
            durations: [],
        };
        current.requestName = execution.requestName;
        current.requestMethod = execution.requestMethod;
        current.durations.push(execution.durationMs as number);
        requestGroupMap.set(execution.requestId, current);
    }

    const requestAverages = Array.from(requestGroupMap.entries())
        .map(([requestId, group]) => {
            const executionCount = group.durations.length;
            const sum = group.durations.reduce((acc, duration) => acc + duration, 0);
            const minDurationMs = Math.min(...group.durations);
            const maxDurationMs = Math.max(...group.durations);
            return {
                requestId,
                requestName: group.requestName,
                requestMethod: group.requestMethod,
                executionCount,
                averageDurationMs: sum / executionCount,
                minDurationMs,
                maxDurationMs,
            };
        })
        .sort((a, b) => a.requestName.localeCompare(b.requestName));

    const iterationMap = new Map<number, RunnerCollectionIterationTotal>();
    for (const execution of sentWithDuration) {
        if (typeof execution.collectionIterationIndex !== "number") continue;
        const existing = iterationMap.get(execution.collectionIterationIndex) ?? {
            collectionIterationIndex: execution.collectionIterationIndex,
            executionCount: 0,
            totalDurationMs: 0,
        };
        existing.executionCount += 1;
        existing.totalDurationMs += execution.durationMs as number;
        iterationMap.set(execution.collectionIterationIndex, existing);
    }

    const collectionIterationTotals = Array.from(iterationMap.values()).sort(
        (a, b) => a.collectionIterationIndex - b.collectionIterationIndex
    );
    const iterationAverage =
        collectionIterationTotals.length > 0
            ? collectionIterationTotals.reduce((acc, iteration) => acc + iteration.totalDurationMs, 0) /
              collectionIterationTotals.length
            : null;

    return {
        mode: run.mode,
        totalDurationMs,
        requestAverages,
        collectionIterationTotals,
        averageCollectionIterationDurationMs: iterationAverage,
    };
}
