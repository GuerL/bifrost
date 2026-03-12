import { useEffect, useMemo, useState } from "react";
import { buttonStyle, dangerButtonStyle, primaryButtonStyle, selectStyle } from "../helpers/UiStyles.ts";
import type { Request } from "../types.ts";
import { calculateRunnerAverages } from "../runner/stats.ts";
import type {
    RunnerExecutionResult,
    RunnerExecutionStatus,
    RunnerIterationMode,
    RunnerRun,
} from "../runner/types.ts";

type RunResultFilter = "all" | "failed" | "success";
type RunnerPanelTab = "executions" | "averages";

type CollectionRunnerModalProps = {
    open: boolean;
    onClose: () => void;
    collectionName: string | null;
    orderedRequests: Request[];
    selectedRequestIds: string[];
    runMode: RunnerIterationMode;
    iterations: number;
    run: RunnerRun | null;
    isRunning: boolean;
    stopOnFailure: boolean;
    onRunModeChange: (next: RunnerIterationMode) => void;
    onIterationsChange: (next: number) => void;
    onStopOnFailureChange: (next: boolean) => void;
    onToggleRequestSelection: (requestId: string, selected: boolean) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onRun: () => void;
    onCancel: () => void;
};

export default function CollectionRunnerModal({
    open,
    onClose,
    collectionName,
    orderedRequests,
    selectedRequestIds,
    runMode,
    iterations,
    run,
    isRunning,
    stopOnFailure,
    onRunModeChange,
    onIterationsChange,
    onStopOnFailureChange,
    onToggleRequestSelection,
    onSelectAll,
    onClearSelection,
    onRun,
    onCancel,
}: CollectionRunnerModalProps) {
    const [resultTab, setResultTab] = useState<RunnerPanelTab>("executions");
    const [executionFilter, setExecutionFilter] = useState<RunResultFilter>("all");
    const [expandedByExecutionId, setExpandedByExecutionId] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!open) return;
        setExecutionFilter("all");
        setResultTab("executions");
        setExpandedByExecutionId({});
    }, [open, run?.runId]);

    const hasRequests = orderedRequests.length > 0;
    const selectedSet = new Set(selectedRequestIds);
    const selectedCount = orderedRequests.filter((request) => selectedSet.has(request.id)).length;
    const canRunSelection = hasRequests && selectedCount > 0;
    const executions = run?.executions ?? [];
    const averages = useMemo(() => (run ? calculateRunnerAverages(run) : null), [run]);

    const visibleExecutions = useMemo(
        () =>
            executions.filter((execution) => {
                if (executionFilter === "failed") {
                    return execution.status === "failed" || execution.status === "cancelled";
                }
                if (executionFilter === "success") {
                    return execution.status === "success";
                }
                return true;
            }),
        [executions, executionFilter]
    );

    if (!open) return null;

    function toggleExpanded(executionId: string) {
        setExpandedByExecutionId((previous) => ({
            ...previous,
            [executionId]: !previous[executionId],
        }));
    }

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 1410,
                background: "rgba(0,0,0,0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
            }}
            onMouseDown={onClose}
        >
            <div
                onMouseDown={(event) => event.stopPropagation()}
                style={{
                    width: "100%",
                    maxWidth: 1120,
                    height: "86vh",
                    maxHeight: 820,
                    border: "1px solid var(--pg-border)",
                    borderRadius: 12,
                    background: "var(--pg-surface-1)",
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                        <h3 style={{ margin: 0 }}>Collection Runner</h3>
                        <div style={{ fontSize: 13, color: "var(--pg-text-muted)", marginTop: 4 }}>
                            {collectionName ? collectionName : "No active collection"}
                        </div>
                    </div>
                    <button onClick={onClose} style={buttonStyle(false)}>
                        Close
                    </button>
                </div>

                <div
                    style={{
                        border: "1px solid var(--pg-border)",
                        borderRadius: 12,
                        background: "var(--pg-surface-0)",
                        padding: 12,
                        display: "grid",
                        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                        gap: 10,
                        alignItems: "end",
                    }}
                >
                    <label style={labelColStyle()}>
                        <span style={labelTextStyle()}>Run mode</span>
                        <select
                            value={runMode}
                            disabled={isRunning}
                            onChange={(event) => onRunModeChange(event.target.value as RunnerIterationMode)}
                            style={selectStyle()}
                        >
                            <option value="request_iteration">Request iteration</option>
                            <option value="collection_iteration">Collection iteration</option>
                        </select>
                    </label>

                    <label style={labelColStyle()}>
                        <span style={labelTextStyle()}>Iterations</span>
                        <input
                            type="number"
                            min={1}
                            step={1}
                            value={iterations}
                            disabled={isRunning}
                            onChange={(event) => {
                                const parsed = Number.parseInt(event.target.value, 10);
                                if (!Number.isFinite(parsed)) {
                                    onIterationsChange(1);
                                    return;
                                }
                                onIterationsChange(Math.max(1, parsed));
                            }}
                        />
                    </label>

                    <label style={{ ...labelColStyle(), justifyContent: "flex-end" }}>
                        <span style={labelTextStyle()}>Stop on first failure</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, height: 34 }}>
                            <input
                                type="checkbox"
                                checked={stopOnFailure}
                                disabled={isRunning}
                                onChange={(event) => onStopOnFailureChange(event.target.checked)}
                                style={{
                                    width: 14,
                                    height: 14,
                                    accentColor: "var(--pg-primary)",
                                    cursor: isRunning ? "not-allowed" : "pointer",
                                }}
                            />
                            <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                Stop immediately on failure
                            </span>
                        </div>
                    </label>

                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                        {isRunning ? (
                            <button onClick={onCancel} style={dangerButtonStyle(false)}>
                                Cancel Run
                            </button>
                        ) : (
                            <button
                                onClick={onRun}
                                disabled={!canRunSelection}
                                style={primaryButtonStyle(!canRunSelection)}
                            >
                                Run Selection
                            </button>
                        )}
                    </div>
                </div>

                <div
                    style={{
                        border: "1px solid var(--pg-border)",
                        borderRadius: 12,
                        background: "var(--pg-surface-0)",
                        padding: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                            Selected {selectedCount} / {orderedRequests.length}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button
                                onClick={onSelectAll}
                                disabled={isRunning || !hasRequests}
                                style={buttonStyle(isRunning || !hasRequests)}
                            >
                                Select all
                            </button>
                            <button
                                onClick={onClearSelection}
                                disabled={isRunning || selectedCount === 0}
                                style={buttonStyle(isRunning || selectedCount === 0)}
                            >
                                Clear
                            </button>
                        </div>
                    </div>

                    {!hasRequests && (
                        <div style={{ color: "var(--pg-text-muted)", fontSize: 13 }}>
                            No request in this collection.
                        </div>
                    )}

                    {hasRequests && (
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                                gap: 8,
                                maxHeight: 120,
                                overflowY: "auto",
                                paddingRight: 4,
                            }}
                        >
                            {orderedRequests.map((request, index) => {
                                const selected = selectedSet.has(request.id);
                                return (
                                    <label
                                        key={request.id}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            border: "1px solid var(--pg-border)",
                                            borderRadius: 10,
                                            padding: "8px 10px",
                                            background: selected ? "var(--pg-surface-1)" : "var(--pg-surface-0)",
                                            opacity: selected ? 1 : 0.72,
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selected}
                                            disabled={isRunning}
                                            onChange={(event) =>
                                                onToggleRequestSelection(request.id, event.target.checked)
                                            }
                                            style={{
                                                width: 14,
                                                height: 14,
                                                accentColor: "var(--pg-primary)",
                                                cursor: isRunning ? "not-allowed" : "pointer",
                                            }}
                                        />
                                        <span
                                            style={{
                                                minWidth: 0,
                                                fontSize: 12,
                                                color: "var(--pg-text-dim)",
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            #{index + 1} {request.method.toUpperCase()} {request.name}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div
                    style={{
                        border: "1px solid var(--pg-border)",
                        borderRadius: 12,
                        background: "var(--pg-surface-0)",
                        minHeight: 0,
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            borderBottom: "1px solid var(--pg-border)",
                            padding: "10px 12px",
                        }}
                    >
                        <div style={{ display: "flex", gap: 8 }}>
                            <button
                                onClick={() => setResultTab("executions")}
                                style={tabButtonStyle(resultTab === "executions")}
                            >
                                Executions
                            </button>
                            <button
                                onClick={() => setResultTab("averages")}
                                style={tabButtonStyle(resultTab === "averages")}
                            >
                                Averages
                            </button>
                        </div>

                        {resultTab === "executions" && (
                            <div style={{ display: "flex", gap: 8 }}>
                                <button
                                    onClick={() => setExecutionFilter("all")}
                                    style={filterTabStyle(executionFilter === "all")}
                                >
                                    All
                                </button>
                                <button
                                    onClick={() => setExecutionFilter("failed")}
                                    style={filterTabStyle(executionFilter === "failed")}
                                >
                                    Failed
                                </button>
                                <button
                                    onClick={() => setExecutionFilter("success")}
                                    style={filterTabStyle(executionFilter === "success")}
                                >
                                    Success
                                </button>
                            </div>
                        )}
                    </div>

                    <div style={{ minHeight: 0, flex: 1, overflowY: "auto", padding: 12 }}>
                        {resultTab === "executions" && (
                            <>
                                {!run && (
                                    <div style={{ color: "var(--pg-text-muted)", fontSize: 13 }}>
                                        No run yet. Configure mode and iterations, then run.
                                    </div>
                                )}

                                {run && visibleExecutions.length === 0 && (
                                    <div style={{ color: "var(--pg-text-muted)", fontSize: 13 }}>
                                        No execution for this filter.
                                    </div>
                                )}

                                {run && visibleExecutions.length > 0 && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                        {visibleExecutions.map((execution) => {
                                            const expanded = !!expandedByExecutionId[execution.executionId];
                                            return (
                                                <div
                                                    key={execution.executionId}
                                                    style={{
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        gap: 8,
                                                        borderRadius: 10,
                                                        border: rowBorderStyle(execution.status),
                                                        background: "var(--pg-surface-1)",
                                                        padding: "8px 10px",
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: "grid",
                                                            gridTemplateColumns: "70px minmax(0, 1fr) auto",
                                                            alignItems: "center",
                                                            gap: 10,
                                                        }}
                                                    >
                                                        <div style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 700 }}>
                                                            #{execution.planIndex}
                                                        </div>
                                                        <div style={{ minWidth: 0 }}>
                                                            <div
                                                                style={{
                                                                    color: "var(--pg-text)",
                                                                    fontSize: 13,
                                                                    fontWeight: 700,
                                                                    whiteSpace: "nowrap",
                                                                    overflow: "hidden",
                                                                    textOverflow: "ellipsis",
                                                                }}
                                                            >
                                                                {execution.requestMethod.toUpperCase()} {execution.requestName}
                                                            </div>
                                                            <div
                                                                style={{
                                                                    fontSize: 12,
                                                                    color: "var(--pg-text-muted)",
                                                                    marginTop: 2,
                                                                    display: "flex",
                                                                    gap: 8,
                                                                    flexWrap: "wrap",
                                                                }}
                                                            >
                                                                <span>Req iteration #{execution.requestIterationIndex}</span>
                                                                {typeof execution.collectionIterationIndex === "number" && (
                                                                    <span>
                                                                        Collection iteration #{execution.collectionIterationIndex}
                                                                    </span>
                                                                )}
                                                                {execution.startedAt && (
                                                                    <span>Started {formatTime(execution.startedAt)}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                            <span style={runStatusBadgeStyle(execution.status)}>
                                                                {runStateLabel(execution.status)}
                                                            </span>
                                                            {typeof execution.httpStatus === "number" && (
                                                                <span style={statusCodeBadgeStyle(execution.httpStatus)}>
                                                                    {execution.httpStatus}
                                                                </span>
                                                            )}
                                                            {typeof execution.durationMs === "number" && (
                                                                <span style={durationBadgeStyle()}>{execution.durationMs}ms</span>
                                                            )}
                                                            <button
                                                                onClick={() => toggleExpanded(execution.executionId)}
                                                                style={expandButtonStyle()}
                                                                title={expanded ? "Hide details" : "Show details"}
                                                            >
                                                                {expanded ? "−" : "+"}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {expanded && (
                                                        <ExecutionDetails execution={execution} />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}

                        {resultTab === "averages" && (
                            <>
                                {!run || !averages ? (
                                    <div style={{ color: "var(--pg-text-muted)", fontSize: 13 }}>
                                        No averages yet. Run the collection to generate stats.
                                    </div>
                                ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                        <div style={{ fontSize: 13, color: "var(--pg-text-dim)" }}>
                                            Total measured duration:{" "}
                                            <strong>{formatDuration(averages.totalDurationMs)}</strong>
                                        </div>

                                        {averages.mode === "request_iteration" && (
                                            <div style={tableWrapStyle()}>
                                                <table style={tableStyle()}>
                                                    <thead>
                                                        <tr>
                                                            <th style={thStyle()}>Request</th>
                                                            <th style={thStyle()}>Method</th>
                                                            <th style={thStyle()}>Executions</th>
                                                            <th style={thStyle()}>Average</th>
                                                            <th style={thStyle()}>Min</th>
                                                            <th style={thStyle()}>Max</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {averages.requestAverages.map((item) => (
                                                            <tr key={item.requestId}>
                                                                <td style={tdStyle()}>{item.requestName}</td>
                                                                <td style={tdStyle()}>{item.requestMethod.toUpperCase()}</td>
                                                                <td style={tdStyle()}>{item.executionCount}</td>
                                                                <td style={tdStyle()}>{formatDuration(item.averageDurationMs)}</td>
                                                                <td style={tdStyle()}>{formatDuration(item.minDurationMs)}</td>
                                                                <td style={tdStyle()}>{formatDuration(item.maxDurationMs)}</td>
                                                            </tr>
                                                        ))}
                                                        {averages.requestAverages.length === 0 && (
                                                            <tr>
                                                                <td style={tdStyle()} colSpan={6}>
                                                                    No request-level timing data.
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}

                                        {averages.mode === "collection_iteration" && (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                                <div style={{ fontSize: 13, color: "var(--pg-text-dim)" }}>
                                                    Average collection iteration duration:{" "}
                                                    <strong>
                                                        {averages.averageCollectionIterationDurationMs == null
                                                            ? "n/a"
                                                            : formatDuration(averages.averageCollectionIterationDurationMs)}
                                                    </strong>
                                                </div>
                                                <div style={tableWrapStyle()}>
                                                    <table style={tableStyle()}>
                                                        <thead>
                                                            <tr>
                                                                <th style={thStyle()}>Collection iteration</th>
                                                                <th style={thStyle()}>Executed requests</th>
                                                                <th style={thStyle()}>Total duration</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {averages.collectionIterationTotals.map((item) => (
                                                                <tr key={item.collectionIterationIndex}>
                                                                    <td style={tdStyle()}>#{item.collectionIterationIndex}</td>
                                                                    <td style={tdStyle()}>{item.executionCount}</td>
                                                                    <td style={tdStyle()}>
                                                                        {formatDuration(item.totalDurationMs)}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                            {averages.collectionIterationTotals.length === 0 && (
                                                                <tr>
                                                                    <td style={tdStyle()} colSpan={3}>
                                                                        No collection-iteration timing data.
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <div
                    style={{
                        border: "1px solid var(--pg-border)",
                        borderRadius: 12,
                        background: "var(--pg-surface-0)",
                        padding: 12,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        flexShrink: 0,
                    }}
                >
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {!run ? (
                            <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>No run yet.</span>
                        ) : (
                            <>
                                <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                    Total {run.summary.total} • OK {run.summary.success} • Failed {run.summary.failed} •
                                    Cancelled {run.summary.cancelled} • Skipped {run.summary.skipped}
                                </span>
                                {run.summary.wasCancelledByUser && (
                                    <span style={{ fontSize: 12, color: "#fbbf24", fontWeight: 700 }}>
                                        Run cancelled by user.
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        {isRunning ? (
                            <button onClick={onCancel} style={dangerButtonStyle(false)}>
                                Cancel Run
                            </button>
                        ) : (
                            <button
                                onClick={onRun}
                                disabled={!canRunSelection}
                                style={primaryButtonStyle(!canRunSelection)}
                            >
                                Run Selection
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function ExecutionDetails({ execution }: { execution: RunnerExecutionResult }) {
    return (
        <div
            style={{
                borderTop: "1px dashed var(--pg-border)",
                paddingTop: 8,
                display: "grid",
                gridTemplateColumns: "180px minmax(0, 1fr)",
                gap: "6px 10px",
                fontSize: 12,
            }}
        >
            <span style={detailLabelStyle()}>Status text</span>
            <span style={detailValueStyle()}>{execution.statusText}</span>

            <span style={detailLabelStyle()}>Sent</span>
            <span style={detailValueStyle()}>{execution.wasSent ? "Yes" : "No"}</span>

            <span style={detailLabelStyle()}>Started</span>
            <span style={detailValueStyle()}>
                {execution.startedAt ? formatDateTime(execution.startedAt) : "—"}
            </span>

            <span style={detailLabelStyle()}>Finished</span>
            <span style={detailValueStyle()}>
                {execution.finishedAt ? formatDateTime(execution.finishedAt) : "—"}
            </span>

            <span style={detailLabelStyle()}>HTTP status</span>
            <span style={detailValueStyle()}>
                {typeof execution.httpStatus === "number" ? execution.httpStatus : "—"}
            </span>

            <span style={detailLabelStyle()}>Error</span>
            <span style={detailValueStyle()}>
                {execution.errorMessage
                    ? `${execution.errorCode ?? "error"}: ${execution.errorMessage}`
                    : "—"}
            </span>

            <span style={detailLabelStyle()}>Duration</span>
            <span style={detailValueStyle()}>
                {typeof execution.durationMs === "number" ? `${execution.durationMs} ms` : "—"}
            </span>

            <span style={detailLabelStyle()}>Response headers</span>
            <span style={detailValueStyle()}>
                {execution.response ? `${execution.response.headers.length} header(s)` : "—"}
            </span>

            <span style={detailLabelStyle()}>Response body</span>
            <span style={detailValueStyle()}>
                {!execution.response || execution.response.bodyText == null ? (
                    "—"
                ) : (
                    <pre
                        style={{
                            margin: 0,
                            padding: 8,
                            border: "1px solid var(--pg-border)",
                            borderRadius: 8,
                            background: "var(--pg-surface-0)",
                            color: "var(--pg-text-dim)",
                            maxHeight: 220,
                            overflow: "auto",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                        }}
                    >
                        {execution.response.bodyText}
                        {execution.response.bodyTruncated ? "\n\n…truncated" : ""}
                    </pre>
                )}
            </span>
        </div>
    );
}

function runStateLabel(state: RunnerExecutionStatus): string {
    if (state === "queued") return "Queued";
    if (state === "running") return "Running";
    if (state === "success") return "Success";
    if (state === "failed") return "Failed";
    if (state === "cancelled") return "Cancelled";
    if (state === "skipped") return "Skipped";
    return "Unknown";
}

function formatDuration(durationMs: number): string {
    return `${durationMs.toFixed(2)} ms`;
}

function formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleTimeString();
}

function labelColStyle(): React.CSSProperties {
    return {
        display: "flex",
        flexDirection: "column",
        gap: 6,
    };
}

function labelTextStyle(): React.CSSProperties {
    return {
        fontSize: 12,
        color: "var(--pg-text-muted)",
        fontWeight: 600,
    };
}

function tabButtonStyle(active: boolean): React.CSSProperties {
    return {
        ...buttonStyle(false),
        height: 30,
        padding: "0 10px",
        borderColor: active ? "var(--pg-primary)" : "var(--pg-border)",
        background: active ? "rgba(var(--pg-primary-rgb), 0.2)" : "var(--pg-surface-1)",
        color: active ? "var(--pg-primary)" : "var(--pg-text-dim)",
        boxShadow: "none",
    };
}

function filterTabStyle(active: boolean): React.CSSProperties {
    return {
        ...buttonStyle(false),
        height: 28,
        padding: "0 10px",
        borderColor: active ? "var(--pg-primary)" : "var(--pg-border)",
        background: active ? "rgba(var(--pg-primary-rgb), 0.2)" : "var(--pg-surface-1)",
        color: active ? "var(--pg-primary)" : "var(--pg-text-dim)",
        boxShadow: "none",
        fontSize: 12,
    };
}

function rowBorderStyle(state: RunnerExecutionStatus): string {
    if (state === "failed") return "1px solid var(--pg-danger)";
    if (state === "cancelled") return "1px solid #f59e0b";
    if (state === "success") return "1px solid rgba(16, 185, 129, 0.5)";
    if (state === "running") return "1px solid var(--pg-primary)";
    return "1px solid var(--pg-border)";
}

function runStatusBadgeStyle(state: RunnerExecutionStatus): React.CSSProperties {
    const tone =
        state === "success"
            ? "rgba(16, 185, 129, 0.22)"
            : state === "failed"
                ? "rgba(239, 68, 68, 0.2)"
                : state === "cancelled"
                    ? "rgba(245, 158, 11, 0.25)"
                    : state === "running"
                        ? "rgba(var(--pg-primary-rgb), 0.28)"
                        : "rgba(148, 163, 184, 0.2)";

    const textColor =
        state === "success"
            ? "#34d399"
            : state === "failed"
                ? "#fda4af"
                : state === "cancelled"
                    ? "#fbbf24"
                    : state === "running"
                        ? "var(--pg-primary)"
                        : "var(--pg-text-muted)";

    return {
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 999,
        padding: "3px 9px",
        color: textColor,
        background: tone,
        border: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
    };
}

function statusCodeBadgeStyle(statusCode: number): React.CSSProperties {
    const success = statusCode >= 200 && statusCode < 300;
    const redirect = statusCode >= 300 && statusCode < 400;
    const clientError = statusCode >= 400 && statusCode < 500;
    const serverError = statusCode >= 500;

    const color = success
        ? "#34d399"
        : redirect
            ? "#93c5fd"
            : clientError
                ? "#fbbf24"
                : serverError
                    ? "#fda4af"
                    : "var(--pg-text-muted)";

    const bg = success
        ? "rgba(16, 185, 129, 0.22)"
        : redirect
            ? "rgba(59, 130, 246, 0.2)"
            : clientError
                ? "rgba(245, 158, 11, 0.2)"
                : serverError
                    ? "rgba(239, 68, 68, 0.2)"
                    : "rgba(148, 163, 184, 0.2)";

    return {
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 999,
        padding: "3px 8px",
        color,
        background: bg,
        border: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
    };
}

function durationBadgeStyle(): React.CSSProperties {
    return {
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 999,
        padding: "3px 8px",
        color: "var(--pg-text-dim)",
        background: "rgba(148, 163, 184, 0.2)",
        border: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
    };
}

function expandButtonStyle(): React.CSSProperties {
    return {
        width: 24,
        height: 24,
        borderRadius: 8,
        border: "1px solid var(--pg-border)",
        background: "var(--pg-surface-0)",
        color: "var(--pg-text-dim)",
        fontWeight: 700,
        lineHeight: 1,
        padding: 0,
        boxShadow: "none",
        cursor: "pointer",
    };
}

function detailLabelStyle(): React.CSSProperties {
    return {
        color: "var(--pg-text-muted)",
        fontWeight: 600,
    };
}

function detailValueStyle(): React.CSSProperties {
    return {
        color: "var(--pg-text-dim)",
        wordBreak: "break-word",
    };
}

function tableWrapStyle(): React.CSSProperties {
    return {
        border: "1px solid var(--pg-border)",
        borderRadius: 10,
        overflow: "hidden",
    };
}

function tableStyle(): React.CSSProperties {
    return {
        width: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
    };
}

function thStyle(): React.CSSProperties {
    return {
        textAlign: "left",
        fontSize: 12,
        color: "var(--pg-text-muted)",
        borderBottom: "1px solid var(--pg-border)",
        padding: "8px 6px",
        background: "var(--pg-surface-1)",
    };
}

function tdStyle(): React.CSSProperties {
    return {
        fontSize: 13,
        color: "var(--pg-text-dim)",
        borderBottom: "1px solid var(--pg-border)",
        padding: "8px 6px",
        background: "var(--pg-surface-0)",
    };
}
