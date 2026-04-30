import type { RunnerRunStatus, RunnerRunSummary } from "./types.ts";

export const RUNNER_COMPLETION_NOTIFICATION_TITLE = "Bifrost Runner finished";

export type RunnerNotificationSummary = {
    title: string;
    body: string;
};

type BuildRunnerNotificationSummaryInput = {
    status: RunnerRunStatus;
    summary: RunnerRunSummary;
};

function formatDurationSeconds(totalDurationMs: number): string {
    const safeDuration = Number.isFinite(totalDurationMs) && totalDurationMs > 0 ? totalDurationMs : 0;
    return `${(safeDuration / 1000).toFixed(1)}s`;
}

function executedRequests(summary: RunnerRunSummary): number {
    return Math.max(0, summary.total - summary.queued - summary.running - summary.skipped);
}

export function buildRunnerNotificationSummary({
    status,
    summary,
}: BuildRunnerNotificationSummaryInput): RunnerNotificationSummary {
    if (status === "cancelled" || summary.wasCancelledByUser) {
        return {
            title: RUNNER_COMPLETION_NOTIFICATION_TITLE,
            body: `Runner cancelled · ${executedRequests(summary)} requests executed · ${summary.failed} failed`,
        };
    }

    if (summary.failed > 0) {
        return {
            title: RUNNER_COMPLETION_NOTIFICATION_TITLE,
            body: `${summary.total} requests · ${summary.success} succeeded · ${summary.failed} failed · ${formatDurationSeconds(summary.totalDurationMs)}`,
        };
    }

    return {
        title: RUNNER_COMPLETION_NOTIFICATION_TITLE,
        body: `${summary.total} requests completed · ${formatDurationSeconds(summary.totalDurationMs)}`,
    };
}
