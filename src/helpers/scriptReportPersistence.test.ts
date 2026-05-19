import { describe, expect, it } from "vitest";
import {
    buildPersistedScriptReport,
    restorePersistedScriptReports,
} from "./scriptReportPersistence.ts";

describe("scriptReportPersistence", () => {
    it("builds report from persisted execution", () => {
        const report = buildPersistedScriptReport({
            preRequestError: null,
            postResponseError: "[post-response] boom",
            summary: { total: 2, passed: 1, failed: 1, skipped: 0 },
            tests: [
                { name: "a", status: "passed", error: null },
                { name: "b", status: "failed", error: "boom" },
            ],
        });

        expect(report).toEqual({
            preRequestError: null,
            postResponseError: "[post-response] boom",
            source: "persisted",
            tests: [
                { name: "a", status: "passed", error: null },
                { name: "b", status: "failed", error: "boom" },
            ],
        });
    });

    it("restores per-request reports and skips empty entries", () => {
        const reports = restorePersistedScriptReports({
            req_1: {
                testExecution: {
                    preRequestError: null,
                    postResponseError: null,
                    summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
                    tests: [{ name: "a", status: "passed", error: null }],
                },
            },
            req_2: { testExecution: null },
        });

        expect(Object.keys(reports)).toEqual(["req_1"]);
        expect(reports.req_1.tests).toEqual([{ name: "a", status: "passed", error: null }]);
        expect(reports.req_1.source).toBe("persisted");
    });
});
