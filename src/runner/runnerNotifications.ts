import type { RunnerRunStatus, RunnerRunSummary } from "./types.ts";
import {
    sendNativeNotification,
    shouldSendRunnerSystemNotification,
} from "./notificationService.ts";
import { buildRunnerNotificationSummary } from "./runnerSummary.ts";

type NotifyRunnerCompletionInput = {
    runId: string;
    status: RunnerRunStatus;
    summary: RunnerRunSummary;
};

const notifiedRunIds = new Set<string>();

export async function notifyRunnerCompletion({
    runId,
    status,
    summary,
}: NotifyRunnerCompletionInput): Promise<void> {
    if (status === "running") {
        return;
    }

    if (notifiedRunIds.has(runId)) {
        return;
    }
    notifiedRunIds.add(runId);

    const shouldNotify = await shouldSendRunnerSystemNotification();
    if (!shouldNotify) {
        return;
    }

    const notification = buildRunnerNotificationSummary({ status, summary });
    await sendNativeNotification(notification);
}
