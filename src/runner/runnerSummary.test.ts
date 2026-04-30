import { describe, expect, it } from "vitest";
import { buildRunnerNotificationSummary } from "./runnerSummary.ts";
import type { RunnerRunSummary } from "./types.ts";

function summary(overrides: Partial<RunnerRunSummary>): RunnerRunSummary {
    return {
        total: 42,
        queued: 0,
        running: 0,
        success: 42,
        failed: 0,
        cancelled: 0,
        skipped: 0,
        wasCancelledByUser: false,
        totalDurationMs: 12_400,
        averageDurationMs: 295.2,
        ...overrides,
    };
}

describe("buildRunnerNotificationSummary", () => {
    it("formats success body", () => {
        const result = buildRunnerNotificationSummary({
            status: "completed",
            summary: summary({}),
        });

        expect(result.title).toBe("Bifrost Runner finished");
        expect(result.body).toBe("42 requests completed · 12.4s");
    });

    it("formats failure body", () => {
        const result = buildRunnerNotificationSummary({
            status: "failed",
            summary: summary({
                success: 39,
                failed: 3,
            }),
        });

        expect(result.body).toBe("42 requests · 39 succeeded · 3 failed · 12.4s");
    });

    it("formats cancelled body", () => {
        const result = buildRunnerNotificationSummary({
            status: "cancelled",
            summary: summary({
                total: 20,
                success: 16,
                failed: 2,
                cancelled: 0,
                skipped: 2,
                wasCancelledByUser: true,
            }),
        });

        expect(result.body).toBe("Runner cancelled · 18 requests executed · 2 failed");
    });
});
