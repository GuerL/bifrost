import type { ScriptTestResult } from "./RequestScriptsRuntime.ts";
import type { PersistedTestExecution } from "./persistedTestExecution.ts";

export type PersistedScriptReport = {
    preRequestError: string | null;
    postResponseError: string | null;
    tests: ScriptTestResult[];
    source: "persisted";
};

export function buildPersistedScriptReport(execution: PersistedTestExecution): PersistedScriptReport {
    return {
        preRequestError: execution.preRequestError,
        postResponseError: execution.postResponseError,
        tests: execution.tests,
        source: "persisted",
    };
}

export function restorePersistedScriptReports(
    entries: Record<string, { testExecution: PersistedTestExecution | null }>
): Record<string, PersistedScriptReport> {
    const restored: Record<string, PersistedScriptReport> = {};

    for (const [requestId, entry] of Object.entries(entries)) {
        if (!entry.testExecution) continue;
        restored[requestId] = buildPersistedScriptReport(entry.testExecution);
    }

    return restored;
}
