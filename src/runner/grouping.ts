import type { RunnerExecutionResult, RunnerIterationMode } from "./types.ts";

export type RunnerExecutionDisplayGroup = {
    id: string;
    label: string;
    executions: RunnerExecutionResult[];
};

export function groupRunnerExecutionsForDisplay(
    executions: RunnerExecutionResult[],
    mode: RunnerIterationMode
): RunnerExecutionDisplayGroup[] {
    const groups: RunnerExecutionDisplayGroup[] = [];
    const groupIndexById = new Map<string, number>();

    for (const execution of executions) {
        const { groupId, label } =
            mode === "request_iteration"
                ? {
                    groupId: `request:${execution.requestId}`,
                    label: `${execution.requestMethod.toUpperCase()} ${execution.requestName}`,
                }
                : {
                    groupId: `collection:${execution.collectionIterationIndex ?? 0}`,
                    label:
                        typeof execution.collectionIterationIndex === "number"
                            ? `Collection run ${execution.collectionIterationIndex}`
                            : "Collection run",
                };

        const existingIndex = groupIndexById.get(groupId);
        if (existingIndex == null) {
            groupIndexById.set(groupId, groups.length);
            groups.push({
                id: groupId,
                label,
                executions: [execution],
            });
            continue;
        }

        groups[existingIndex].executions.push(execution);
    }

    return groups;
}
