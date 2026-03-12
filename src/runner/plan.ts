import type { Request } from "../types.ts";
import type { RunnerExecutionPlanItem, RunnerIterationMode } from "./types.ts";

type BuildRunnerExecutionPlanInput = {
    orderedRequests: Request[];
    selectedRequestIds: string[];
    mode: RunnerIterationMode;
    iterations: number;
};

export function buildRunnerExecutionPlan({
    orderedRequests,
    selectedRequestIds,
    mode,
    iterations,
}: BuildRunnerExecutionPlanInput): RunnerExecutionPlanItem[] {
    const safeIterations = Number.isFinite(iterations)
        ? Math.max(1, Math.floor(iterations))
        : 1;

    const selected = new Set(selectedRequestIds);
    const selectedRequests = orderedRequests.filter((request) => selected.has(request.id));

    const plan: RunnerExecutionPlanItem[] = [];
    let planIndex = 1;

    if (mode === "request_iteration") {
        for (const request of selectedRequests) {
            for (let requestIterationIndex = 1; requestIterationIndex <= safeIterations; requestIterationIndex += 1) {
                plan.push({
                    planIndex,
                    requestId: request.id,
                    requestName: request.name,
                    requestMethod: request.method,
                    iterationMode: mode,
                    requestIterationIndex,
                    collectionIterationIndex: null,
                });
                planIndex += 1;
            }
        }
        return plan;
    }

    const requestExecutionIndexById = new Map<string, number>();
    for (let collectionIterationIndex = 1; collectionIterationIndex <= safeIterations; collectionIterationIndex += 1) {
        for (const request of selectedRequests) {
            const requestIterationIndex = (requestExecutionIndexById.get(request.id) ?? 0) + 1;
            requestExecutionIndexById.set(request.id, requestIterationIndex);
            plan.push({
                planIndex,
                requestId: request.id,
                requestName: request.name,
                requestMethod: request.method,
                iterationMode: mode,
                requestIterationIndex,
                collectionIterationIndex,
            });
            planIndex += 1;
        }
    }

    return plan;
}
