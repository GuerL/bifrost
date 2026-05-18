import type { ScriptTestResult } from "./RequestScriptsRuntime.ts";

export type GroupedScriptTests = {
    failed: ScriptTestResult[];
    passed: ScriptTestResult[];
};

export type TestSectionsExpansion = {
    failedExpanded: boolean;
    passedExpanded: boolean;
};

export function groupScriptTests(tests: ScriptTestResult[]): GroupedScriptTests {
    const failed = tests.filter((test) => test.status === "failed");
    const passed = tests.filter((test) => test.status === "passed");
    return { failed, passed };
}

export function defaultTestSectionsExpansion(tests: ScriptTestResult[]): TestSectionsExpansion {
    const { failed, passed } = groupScriptTests(tests);
    if (failed.length > 0) {
        return {
            failedExpanded: true,
            passedExpanded: false,
        };
    }

    return {
        failedExpanded: false,
        passedExpanded: passed.length > 0,
    };
}
