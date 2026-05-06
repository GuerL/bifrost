import { describe, expect, it } from "vitest";
import { buildExecutionVariableValues } from "./executionRuntimeVariables.ts";

describe("buildExecutionVariableValues", () => {
    it("uses env values when runtime is inactive", () => {
        const result = buildExecutionVariableValues({
            environmentValues: new Map([["token", "from-env"]]),
            runtimeVariables: { token: "from-runtime", trace: "123" },
            runtimeActive: false,
        });

        expect(Array.from(result.entries())).toEqual([["token", "from-env"]]);
    });

    it("lets runtime override env while execution is active", () => {
        const result = buildExecutionVariableValues({
            environmentValues: new Map([["token", "from-env"], ["envOnly", "kept"]]),
            runtimeVariables: { token: "from-runtime", runtimeOnly: "yes" },
            runtimeActive: true,
        });

        expect(Array.from(result.entries())).toEqual([
            ["token", "from-runtime"],
            ["envOnly", "kept"],
            ["runtimeOnly", "yes"],
        ]);
    });
});
