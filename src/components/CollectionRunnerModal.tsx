import { type ReactElement, useEffect, useMemo, useState } from "react";
import { buttonStyle, dangerButtonStyle, primaryButtonStyle, selectStyle } from "../helpers/UiStyles.ts";
import type { CollectionNode, Request } from "../types.ts";
import { groupRunnerExecutionsForDisplay } from "../runner/grouping.ts";
import { calculateRunnerAverages } from "../runner/stats.ts";
import type {
    RunnerExecutionResult,
    RunnerExecutionStatus,
    RunnerIterationMode,
    RunnerRun,
} from "../runner/types.ts";

type RunResultFilter = "all" | "failed" | "success";
type RunnerPanelTab = "executions" | "averages";
type RunnerMainTab = "setup" | "results";

type RunnerSelectionFolderNode = {
    kind: "folder";
    folderId: string;
    name: string;
    children: RunnerSelectionTreeNode[];
    requestIds: string[];
};

type RunnerSelectionRequestNode = {
    kind: "request";
    requestId: string;
    request: Request | null;
};

type RunnerSelectionTreeNode = RunnerSelectionFolderNode | RunnerSelectionRequestNode;
const RUNNER_TREE_INDENT_PX = 24;

type CollectionRunnerModalProps = {
    open: boolean;
    onClose: () => void;
    collectionName: string | null;
    collectionItems: CollectionNode[];
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
    onToggleFolderSelection: (requestIds: string[], selected: boolean) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onRun: () => void;
    onCancel: () => void;
};

export default function CollectionRunnerModal({
    open,
    onClose,
    collectionName,
    collectionItems,
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
    onToggleFolderSelection,
    onSelectAll,
    onClearSelection,
    onRun,
    onCancel,
}: CollectionRunnerModalProps) {
    const [mainTab, setMainTab] = useState<RunnerMainTab>("setup");
    const [resultTab, setResultTab] = useState<RunnerPanelTab>("executions");
    const [executionFilter, setExecutionFilter] = useState<RunResultFilter>("all");
    const [expandedByGroupId, setExpandedByGroupId] = useState<Record<string, boolean>>({});
    const [expandedByExecutionId, setExpandedByExecutionId] = useState<Record<string, boolean>>({});
    const [expandedFolderTreeById, setExpandedFolderTreeById] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!open) return;
        setMainTab("setup");
        setExecutionFilter("all");
        setResultTab("executions");
        setExpandedByGroupId({});
        setExpandedByExecutionId({});
        setExpandedFolderTreeById({});
    }, [open]);

    useEffect(() => {
        if (!open) return;
        setExecutionFilter("all");
        setResultTab("executions");
        setExpandedByGroupId({});
        setExpandedByExecutionId({});
    }, [run?.runId, open]);

    useEffect(() => {
        if (!open) return;
        if (isRunning) {
            setMainTab("results");
        }
    }, [isRunning, open]);

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
    const groupedExecutions = useMemo(
        () => groupRunnerExecutionsForDisplay(visibleExecutions, run?.mode ?? runMode),
        [visibleExecutions, run?.mode, runMode]
    );
    const requestById = useMemo(
        () => new Map(orderedRequests.map((request) => [request.id, request])),
        [orderedRequests]
    );
    const requestOrderIndexById = useMemo(() => {
        const map = new Map<string, number>();
        orderedRequests.forEach((request, index) => {
            map.set(request.id, index + 1);
        });
        return map;
    }, [orderedRequests]);
    const selectionTree = useMemo(
        () => buildRunnerSelectionTree(collectionItems, requestById),
        [collectionItems, requestById]
    );

    if (!open) return null;

    function toggleGroupExpanded(groupId: string) {
        setExpandedByGroupId((previous) => ({
            ...previous,
            [groupId]: !(previous[groupId] ?? true),
        }));
    }

    function toggleExpanded(executionId: string) {
        setExpandedByExecutionId((previous) => ({
            ...previous,
            [executionId]: !previous[executionId],
        }));
    }

    function runAndOpenResults() {
        setMainTab("results");
        onRun();
    }

    function toggleFolderTreeExpanded(folderId: string) {
        setExpandedFolderTreeById((previous) => ({
            ...previous,
            [folderId]: !(previous[folderId] ?? true),
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
                        padding: 8,
                        display: "flex",
                        gap: 8,
                    }}
                >
                    <button
                        onClick={() => setMainTab("setup")}
                        style={tabButtonStyle(mainTab === "setup")}
                    >
                        Setup
                    </button>
                    <button
                        onClick={() => setMainTab("results")}
                        style={tabButtonStyle(mainTab === "results")}
                    >
                        Results
                    </button>
                </div>

                {mainTab === "setup" && (
                    <>
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
                                        onClick={runAndOpenResults}
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
                                gap: 10,
                                minHeight: 0,
                                flex: 1,
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
                                        border: "1px solid var(--pg-border)",
                                        borderRadius: 10,
                                        background: "var(--pg-surface-1)",
                                        overflowY: "auto",
                                        overflowX: "hidden",
                                        padding: 8,
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 6,
                                        minHeight: 0,
                                        flex: 1,
                                    }}
                                >
                                    {renderRunnerSelectionTreeNodes({
                                        nodes: selectionTree,
                                        depth: 0,
                                        selectedSet,
                                        isRunning,
                                        expandedFolderTreeById,
                                        requestOrderIndexById,
                                        onToggleExpanded: toggleFolderTreeExpanded,
                                        onToggleFolderSelection,
                                        onToggleRequestSelection,
                                    })}
                                </div>
                            )}
                        </div>
                    </>
                )}

                {mainTab === "results" && (
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
                                        {groupedExecutions.map((group) => {
                                            const groupExpanded = expandedByGroupId[group.id] ?? true;
                                            return (
                                                <div
                                                    key={group.id}
                                                    style={{
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        gap: 8,
                                                        borderRadius: 10,
                                                        border: "1px solid var(--pg-border)",
                                                        background: "var(--pg-surface-0)",
                                                        overflow: "hidden",
                                                    }}
                                                >
                                                    <button
                                                        onClick={() => toggleGroupExpanded(group.id)}
                                                        style={{
                                                            border: "none",
                                                            borderRadius: 0,
                                                            background: "var(--pg-surface-1)",
                                                            color: "var(--pg-text)",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "space-between",
                                                            gap: 12,
                                                            width: "100%",
                                                            cursor: "pointer",
                                                            padding: "10px 12px",
                                                            boxShadow: "none",
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: 8,
                                                                minWidth: 0,
                                                            }}
                                                        >
                                                            <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                                                {groupExpanded ? "▼" : "▶"}
                                                            </span>
                                                            <span
                                                                style={{
                                                                    fontSize: 13,
                                                                    fontWeight: 700,
                                                                    color: "var(--pg-text)",
                                                                    whiteSpace: "nowrap",
                                                                    overflow: "hidden",
                                                                    textOverflow: "ellipsis",
                                                                }}
                                                            >
                                                                {group.label}
                                                            </span>
                                                        </div>
                                                        <div style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 700 }}>
                                                            {group.executions.length} item{group.executions.length > 1 ? "s" : ""}
                                                        </div>
                                                    </button>

                                                    {groupExpanded && (
                                                        <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
                                                            {group.executions.map((execution) => {
                                                                const expanded = !!expandedByExecutionId[execution.executionId];
                                                                return (
                                                                    <ExecutionRow
                                                                        key={execution.executionId}
                                                                        execution={execution}
                                                                        expanded={expanded}
                                                                        onToggleExpanded={() => toggleExpanded(execution.executionId)}
                                                                    />
                                                                );
                                                            })}
                                                        </div>
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
                )}

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
                                onClick={runAndOpenResults}
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

function ExecutionRow({
    execution,
    expanded,
    onToggleExpanded,
}: {
    execution: RunnerExecutionResult;
    expanded: boolean;
    onToggleExpanded: () => void;
}) {
    return (
        <div
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
                        onClick={onToggleExpanded}
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
}

function buildRunnerSelectionTree(
    items: CollectionNode[],
    requestById: Map<string, Request>
): RunnerSelectionTreeNode[] {
    const toNodes = (nodes: CollectionNode[]): RunnerSelectionTreeNode[] =>
        nodes.map((node) => {
            if (node.type === "request_ref") {
                return {
                    kind: "request",
                    requestId: node.request_id,
                    request: requestById.get(node.request_id) ?? null,
                };
            }

            const children = toNodes(node.children);
            const requestIds: string[] = [];
            for (const child of children) {
                if (child.kind === "request") {
                    requestIds.push(child.requestId);
                    continue;
                }
                requestIds.push(...child.requestIds);
            }

            return {
                kind: "folder",
                folderId: node.id,
                name: node.name,
                children,
                requestIds,
            };
        });

    return toNodes(items);
}

function renderRunnerSelectionTreeNodes({
    nodes,
    depth,
    selectedSet,
    isRunning,
    expandedFolderTreeById,
    requestOrderIndexById,
    onToggleExpanded,
    onToggleFolderSelection,
    onToggleRequestSelection,
}: {
    nodes: RunnerSelectionTreeNode[];
    depth: number;
    selectedSet: Set<string>;
    isRunning: boolean;
    expandedFolderTreeById: Record<string, boolean>;
    requestOrderIndexById: Map<string, number>;
    onToggleExpanded: (folderId: string) => void;
    onToggleFolderSelection: (requestIds: string[], selected: boolean) => void;
    onToggleRequestSelection: (requestId: string, selected: boolean) => void;
}): ReactElement[] {
    const out: ReactElement[] = [];

    for (const node of nodes) {
        if (node.kind === "folder") {
            const total = node.requestIds.length;
            const selectedInGroup = node.requestIds.filter((id) => selectedSet.has(id)).length;
            const allSelected = total > 0 && selectedInGroup === total;
            const partiallySelected = selectedInGroup > 0 && selectedInGroup < total;
            const expanded = expandedFolderTreeById[node.folderId] ?? true;

            out.push(
                <div key={node.folderId} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div
                        style={{
                            paddingLeft: depth * RUNNER_TREE_INDENT_PX,
                            minWidth: 0,
                            boxSizing: "border-box",
                        }}
                    >
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "18px minmax(0, 1fr) auto",
                                alignItems: "center",
                                gap: 8,
                                minWidth: 0,
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={allSelected}
                                disabled={isRunning || total === 0}
                                onChange={(event) =>
                                    onToggleFolderSelection(node.requestIds, event.target.checked)
                                }
                                ref={(input) => {
                                    if (!input) return;
                                    input.indeterminate = partiallySelected && !allSelected;
                                }}
                                style={{
                                    width: 14,
                                    height: 14,
                                    accentColor: "var(--pg-primary)",
                                    cursor: isRunning || total === 0 ? "not-allowed" : "pointer",
                                }}
                                title={`Select folder ${node.name}`}
                            />

                            <button
                                onClick={() => onToggleExpanded(node.folderId)}
                                style={{
                                    border: "1px solid var(--pg-border)",
                                    borderRadius: 8,
                                    background: expanded
                                        ? "rgba(var(--pg-primary-rgb), 0.08)"
                                        : "var(--pg-surface-0)",
                                    color: "var(--pg-text)",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    width: "100%",
                                    minWidth: 0,
                                    cursor: "pointer",
                                    padding: "6px 8px",
                                    boxShadow: "none",
                                    fontSize: 12,
                                    textAlign: "left",
                                }}
                                title={node.name}
                            >
                                <span style={{ color: "var(--pg-text-muted)", width: 10, textAlign: "center" }}>
                                    {expanded ? "▾" : "▸"}
                                </span>
                                <span
                                    style={{
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        minWidth: 0,
                                        flex: 1,
                                    }}
                                >
                                    {node.name}
                                </span>
                            </button>

                            <span style={{ fontSize: 11, color: "var(--pg-text-muted)", fontWeight: 700 }}>
                                {selectedInGroup}/{total}
                            </span>
                        </div>
                    </div>

                    {expanded && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {renderRunnerSelectionTreeNodes({
                                nodes: node.children,
                                depth: depth + 1,
                                selectedSet,
                                isRunning,
                                expandedFolderTreeById,
                                requestOrderIndexById,
                                onToggleExpanded,
                                onToggleFolderSelection,
                                onToggleRequestSelection,
                            })}
                        </div>
                    )}
                </div>
            );
            continue;
        }

        const selected = selectedSet.has(node.requestId);
        const request = node.request;
        const requestNumber = requestOrderIndexById.get(node.requestId);
        const disabled = isRunning || !request;

        out.push(
            <div
                key={node.requestId}
                style={{
                    paddingLeft: depth * RUNNER_TREE_INDENT_PX,
                    minWidth: 0,
                    boxSizing: "border-box",
                }}
            >
                <label
                    style={{
                        display: "grid",
                        gridTemplateColumns: "18px 38px minmax(52px, auto) minmax(0, 1fr)",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        minWidth: 0,
                        boxSizing: "border-box",
                        border: "1px solid var(--pg-border)",
                        borderRadius: 10,
                        paddingTop: 7,
                        paddingBottom: 7,
                        paddingLeft: 10,
                        paddingRight: 10,
                        background: selected
                            ? "rgba(var(--pg-primary-rgb), 0.12)"
                            : "var(--pg-surface-0)",
                        opacity: selected ? 1 : 0.85,
                    }}
                >
                    <input
                        type="checkbox"
                        checked={selected}
                        disabled={disabled}
                        onChange={(event) => onToggleRequestSelection(node.requestId, event.target.checked)}
                        style={{
                            width: 14,
                            height: 14,
                            accentColor: "var(--pg-primary)",
                            cursor: disabled ? "not-allowed" : "pointer",
                        }}
                    />
                    <span style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 700 }}>
                        #{requestNumber ?? "?"}
                    </span>
                    <span
                        style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: request ? "var(--pg-text)" : "var(--pg-text-muted)",
                            border: "1px solid var(--pg-border)",
                            borderRadius: 999,
                            padding: "3px 8px",
                            textAlign: "center",
                            background: "var(--pg-surface-1)",
                        }}
                    >
                        {request ? request.method.toUpperCase() : "MISSING"}
                    </span>
                    <span
                        style={{
                            minWidth: 0,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            fontSize: 13,
                            color: request ? "var(--pg-text)" : "var(--pg-danger)",
                        }}
                        title={request?.name ?? `Missing request (${node.requestId})`}
                    >
                        {request?.name ?? `Missing request (${node.requestId})`}
                    </span>
                </label>
            </div>
        );
    }

    return out;
}

function ExecutionDetails({ execution }: { execution: RunnerExecutionResult }) {
    const preRequestScriptError = execution.preRequestScriptError ?? null;
    const postResponseScriptError = execution.postResponseScriptError ?? null;
    const preRequestScriptTests = execution.preRequestScriptTests ?? [];
    const postResponseScriptTests = execution.postResponseScriptTests ?? [];

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

            <span style={detailLabelStyle()}>Pre-request script</span>
            <span style={detailValueStyle()}>{preRequestScriptError ?? "—"}</span>

            <span style={detailLabelStyle()}>Post-response script</span>
            <span style={detailValueStyle()}>{postResponseScriptError ?? "—"}</span>

            <span style={detailLabelStyle()}>Pre-request tests</span>
            <span style={detailValueStyle()}>
                {preRequestScriptTests.length === 0 ? (
                    "—"
                ) : (
                    <div style={{ display: "grid", gap: 4 }}>
                        {preRequestScriptTests.map((test, index) => (
                            <div
                                key={`${test.name}-${index}`}
                                style={{
                                    color: test.status === "passed" ? "var(--pg-primary-soft)" : "var(--pg-danger)",
                                }}
                            >
                                {test.status === "passed" ? "✓" : "✗"} {test.name}
                                {test.error ? ` — ${test.error}` : ""}
                            </div>
                        ))}
                    </div>
                )}
            </span>

            <span style={detailLabelStyle()}>Post-response tests</span>
            <span style={detailValueStyle()}>
                {postResponseScriptTests.length === 0 ? (
                    "—"
                ) : (
                    <div style={{ display: "grid", gap: 4 }}>
                        {postResponseScriptTests.map((test, index) => (
                            <div
                                key={`${test.name}-${index}`}
                                style={{
                                    color: test.status === "passed" ? "var(--pg-primary-soft)" : "var(--pg-danger)",
                                }}
                            >
                                {test.status === "passed" ? "✓" : "✗"} {test.name}
                                {test.error ? ` — ${test.error}` : ""}
                            </div>
                        ))}
                    </div>
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
    return date.toUTCString();
}

function formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const time = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "UTC",
    }).format(date);
    return `${time} GMT`;
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
