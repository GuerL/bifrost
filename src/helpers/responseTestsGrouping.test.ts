import { describe, expect, it } from "vitest";
import {
    defaultTestSectionsExpansion,
    groupScriptTests,
} from "./responseTestsGrouping.ts";

describe("groupScriptTests", () => {
    it("groups failed and passed tests", () => {
        const grouped = groupScriptTests([
            { name: "a", status: "passed", error: null },
            { name: "b", status: "failed", error: "boom" },
            { name: "c", status: "passed", error: null },
        ]);

        expect(grouped.failed.map((test) => test.name)).toEqual(["b"]);
        expect(grouped.passed.map((test) => test.name)).toEqual(["a", "c"]);
    });
});

describe("defaultTestSectionsExpansion", () => {
    it("expands failed and collapses passed when failures exist", () => {
        const expansion = defaultTestSectionsExpansion([
            { name: "a", status: "passed", error: null },
            { name: "b", status: "failed", error: "boom" },
        ]);

        expect(expansion).toEqual({
            failedExpanded: true,
            passedExpanded: false,
        });
    });

    it("expands passed when no failures exist", () => {
        const expansion = defaultTestSectionsExpansion([
            { name: "a", status: "passed", error: null },
        ]);

        expect(expansion).toEqual({
            failedExpanded: false,
            passedExpanded: true,
        });
    });

    it("keeps both collapsed when no tests exist", () => {
        const expansion = defaultTestSectionsExpansion([]);

        expect(expansion).toEqual({
            failedExpanded: false,
            passedExpanded: false,
        });
    });
});
