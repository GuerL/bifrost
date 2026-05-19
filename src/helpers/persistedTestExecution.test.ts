import { describe, expect, it } from "vitest";
import {
    createPersistedTestExecution,
    normalizeStatusTextWithTestExecution,
    sanitizePersistedTestExecution,
} from "./persistedTestExecution.ts";

describe("persistedTestExecution", () => {
    it("creates a serializable execution snapshot with summary", () => {
        const snapshot = createPersistedTestExecution({
            preRequestError: null,
            postResponseError: null,
            tests: [
                { name: "a", status: "passed", error: null },
                { name: "b", status: "failed", error: "boom", line: 3, durationMs: 12 },
            ],
        });

        expect(snapshot.summary).toEqual({
            total: 2,
            passed: 1,
            failed: 1,
            skipped: 0,
        });
        expect(snapshot.tests[1]).toMatchObject({
            name: "b",
            status: "failed",
            error: "boom",
            line: 3,
            durationMs: 12,
        });
    });

    it("sanitizes malformed payload safely", () => {
        expect(sanitizePersistedTestExecution(null)).toBeNull();
        expect(sanitizePersistedTestExecution({ tests: "bad" })).toBeNull();

        const sanitized = sanitizePersistedTestExecution({
            tests: [
                { name: "ok", status: "passed", error: null },
                { name: 12, status: "failed", error: "bad" },
            ],
            summary: {
                total: 99,
                passed: 88,
                failed: 11,
                skipped: 1,
            },
            preRequestError: "x",
            postResponseError: 123,
        });

        expect(sanitized).toEqual({
            preRequestError: "x",
            postResponseError: null,
            summary: {
                total: 2,
                passed: 1,
                failed: 0,
                skipped: 1,
            },
            tests: [{ name: "ok", status: "passed", error: null }],
        });
    });

    it("normalizes status text with execution summary", () => {
        const execution = sanitizePersistedTestExecution({
            tests: [
                { name: "a", status: "passed", error: null },
                { name: "b", status: "failed", error: "boom" },
            ],
        });

        const withOldSuffix = "✅ 200 in 40ms • tests 8/9";
        expect(normalizeStatusTextWithTestExecution(withOldSuffix, execution)).toBe(
            "✅ 200 in 40ms • tests 1/2"
        );

        expect(normalizeStatusTextWithTestExecution(withOldSuffix, null)).toBe(
            "✅ 200 in 40ms"
        );
    });

    it("round-trips through JSON", () => {
        const snapshot = createPersistedTestExecution({
            preRequestError: null,
            postResponseError: "[post-response] boom",
            tests: [
                {
                    name: "status",
                    status: "failed",
                    error: "Expected 200 to be 201",
                    line: 12,
                    column: 3,
                    scriptPhase: "post-response",
                    durationMs: 4,
                },
            ],
        });

        const raw = JSON.stringify(snapshot);
        const restored = sanitizePersistedTestExecution(JSON.parse(raw));

        expect(restored).toEqual(snapshot);
    });
});
