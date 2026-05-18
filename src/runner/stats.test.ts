import { describe, expect, it } from "vitest";
import { createQueuedExecutionResult } from "./mappers.ts";
import { summarizeRunnerExecutions } from "./stats.ts";
import type { RunnerExecutionPlanItem } from "./types.ts";

function planItem(planIndex: number): RunnerExecutionPlanItem {
    return {
        planIndex,
        requestId: `req_${planIndex}`,
        requestName: `Request ${planIndex}`,
        requestMethod: "get",
        iterationMode: "collection_iteration",
        requestIterationIndex: planIndex,
        collectionIterationIndex: 1,
    };
}

describe("summarizeRunnerExecutions", () => {
    it("aggregates test totals without converting test failures into request failures", () => {
        const executionA = {
            ...createQueuedExecutionResult("run", planItem(1)),
            status: "success" as const,
            wasSent: true,
            durationMs: 20,
            testTotal: 2,
            testPassed: 2,
            testFailed: 0,
            hasTestFailures: false,
        };

        const executionB = {
            ...createQueuedExecutionResult("run", planItem(2)),
            status: "success" as const,
            wasSent: true,
            durationMs: 25,
            testTotal: 1,
            testPassed: 0,
            testFailed: 1,
            hasTestFailures: true,
        };

        const executionC = {
            ...createQueuedExecutionResult("run", planItem(3)),
            status: "failed" as const,
            wasSent: true,
            durationMs: 10,
            errorCode: "http_status",
            errorMessage: "Request returned HTTP 500",
            testTotal: 0,
            testPassed: 0,
            testFailed: 0,
            hasTestFailures: false,
        };

        const summary = summarizeRunnerExecutions(
            [executionA, executionB, executionC],
            false
        );

        expect(summary.total).toBe(3);
        expect(summary.success).toBe(2);
        expect(summary.failed).toBe(1);
        expect(summary.totalTests).toBe(3);
        expect(summary.passedTests).toBe(2);
        expect(summary.failedTests).toBe(1);
    });
});
