import { useEffect, useMemo, useState } from "react";
import { buttonStyle, dangerButtonStyle, primaryButtonStyle } from "../helpers/UiStyles.ts";
import type { Request } from "../types.ts";

export type CollectionRunState =
    | "queued"
    | "running"
    | "success"
    | "failed"
    | "cancelled"
    | "skipped"
    | "idle";

export type CollectionRunEntry = {
    state: CollectionRunState;
    statusText: string;
    statusCode?: number;
    durationMs?: number;
    errorKind?: string;
    errorMessage?: string;
    startedAt?: string;
    finishedAt?: string;
};

export type CollectionRunSummary = {
    startedAt: string;
    endedAt: string | null;
    total: number;
    success: number;
    failed: number;
    cancelled: number;
    skipped: number;
    stopOnFailure: boolean;
    cancelledByUser: boolean;
};

type CollectionRunnerModalProps = {
    open: boolean;
    onClose: () => void;
    collectionName: string | null;
    orderedRequests: Request[];
    selectedRequestIds: string[];
    runByRequestId: Record<string, CollectionRunEntry>;
    runSummary: CollectionRunSummary | null;
    isRunning: boolean;
    stopOnFailure: boolean;
    onStopOnFailureChange: (next: boolean) => void;
    onToggleRequestSelection: (requestId: string, selected: boolean) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onRun: () => void;
    onCancel: () => void;
};

type RunResultFilter = "all" | "failed" | "success";

export default function CollectionRunnerModal({
    open,
    onClose,
    collectionName,
    orderedRequests,
    selectedRequestIds,
    runByRequestId,
    runSummary,
    isRunning,
    stopOnFailure,
    onStopOnFailureChange,
    onToggleRequestSelection,
    onSelectAll,
    onClearSelection,
    onRun,
    onCancel,
}: CollectionRunnerModalProps) {
    const [filter, setFilter] = useState<RunResultFilter>("all");
    const [expandedByRequestId, setExpandedByRequestId] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!open) return;
        setFilter("all");
        setExpandedByRequestId({});
    }, [open, runSummary?.startedAt]);

    const hasRequests = orderedRequests.length > 0;
    const selectedSet = new Set(selectedRequestIds);
    const selectedCount = orderedRequests.filter((request) => selectedSet.has(request.id)).length;
    const canRunSelection = hasRequests && selectedCount > 0;
    const visibleRequests = useMemo(
        () =>
            orderedRequests.filter((request) => {
                const runEntry = runByRequestId[request.id] ?? { state: "idle", statusText: "Idle" };
                if (filter === "failed") {
                    return runEntry.state === "failed" || runEntry.state === "cancelled";
                }
                if (filter === "success") {
                    return runEntry.state === "success";
                }
                return true;
            }),
        [orderedRequests, runByRequestId, filter]
    );
    const modeText = runSummary
        ? runSummary.stopOnFailure
            ? "Mode: stop on first failure"
            : "Mode: continue after failures"
        : stopOnFailure
            ? "Mode: stop on first failure"
            : "Mode: continue after failures";

    if (!open) return null;

    function toggleExpanded(requestId: string) {
        setExpandedByRequestId((previous) => ({
            ...previous,
            [requestId]: !previous[requestId],
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
                    maxWidth: 960,
                    height: "80vh",
                    maxHeight: 760,
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
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        flexShrink: 0,
                    }}
                >
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pg-text)" }}>
                            {isRunning ? "Run in progress" : "Ready"}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>{modeText}</div>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
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
                        <span style={{ fontSize: 12, color: "var(--pg-text-dim)" }}>Stop on first failure</span>
                    </label>
                </div>

                <div
                    style={{
                        border: "1px solid var(--pg-border)",
                        borderRadius: 12,
                        background: "var(--pg-surface-0)",
                        padding: 12,
                        minHeight: 0,
                        flex: 1,
                        overflowY: "auto",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                            marginBottom: 10,
                        }}
                    >
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
                        <div style={{ color: "var(--pg-text-muted)" }}>No request in this collection.</div>
                    )}

                    {hasRequests && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ display: "flex", gap: 8 }}>
                                <button onClick={() => setFilter("all")} style={filterTabStyle(filter === "all")}>
                                    All
                                </button>
                                <button onClick={() => setFilter("failed")} style={filterTabStyle(filter === "failed")}>
                                    Failed
                                </button>
                                <button onClick={() => setFilter("success")} style={filterTabStyle(filter === "success")}>
                                    Success
                                </button>
                            </div>

                            {visibleRequests.map((request, index) => {
                                const runEntry = runByRequestId[request.id] ?? {
                                    state: "idle",
                                    statusText: "Idle",
                                };
                                const selected = selectedSet.has(request.id);
                                const expanded = !!expandedByRequestId[request.id];
                                const stepNumber =
                                    orderedRequests.findIndex((entry) => entry.id === request.id) + 1;
                                return (
                                    <div
                                        key={request.id}
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 8,
                                            borderRadius: 10,
                                            border: rowBorderStyle(runEntry.state),
                                            background: selected ? "var(--pg-surface-1)" : "var(--pg-surface-0)",
                                            padding: "8px 10px",
                                            opacity: selected ? 1 : 0.72,
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "grid",
                                                gridTemplateColumns: "30px 56px minmax(0, 1fr) auto",
                                                alignItems: "center",
                                                gap: 10,
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
                                            <div style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 700 }}>
                                                #{stepNumber > 0 ? stepNumber : index + 1}
                                            </div>
                                            <div style={{ minWidth: 0 }}>
                                                <div
                                                    style={{
                                                        color: "var(--pg-text)",
                                                        fontSize: 13,
                                                        fontWeight: 600,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                    }}
                                                >
                                                    {request.method.toUpperCase()} {request.name}
                                                </div>
                                                <div
                                                    style={{
                                                        fontSize: 12,
                                                        color: "var(--pg-text-muted)",
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        marginTop: 2,
                                                    }}
                                                    title={runEntry.statusText}
                                                >
                                                    {runEntry.statusText}
                                                    {runEntry.startedAt
                                                        ? ` • ${formatTime(runEntry.startedAt)}`
                                                        : ""}
                                                </div>
                                            </div>
                                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                <span style={runStatusBadgeStyle(runEntry.state)}>
                                                    {runStateLabel(runEntry.state)}
                                                </span>
                                                {typeof runEntry.statusCode === "number" && (
                                                    <span style={statusCodeBadgeStyle(runEntry.statusCode)}>
                                                        {runEntry.statusCode}
                                                    </span>
                                                )}
                                                {typeof runEntry.durationMs === "number" && (
                                                    <span style={durationBadgeStyle()}>{runEntry.durationMs}ms</span>
                                                )}
                                                <button
                                                    onClick={() => toggleExpanded(request.id)}
                                                    style={expandButtonStyle()}
                                                    title={expanded ? "Hide details" : "Show details"}
                                                >
                                                    {expanded ? "−" : "+"}
                                                </button>
                                            </div>
                                        </div>

                                        {expanded && (
                                            <div
                                                style={{
                                                    borderTop: "1px dashed var(--pg-border)",
                                                    paddingTop: 8,
                                                    display: "grid",
                                                    gridTemplateColumns: "140px minmax(0, 1fr)",
                                                    gap: "6px 10px",
                                                    fontSize: 12,
                                                }}
                                            >
                                                <span style={detailLabelStyle()}>Request id</span>
                                                <span style={detailValueStyle()}>{request.id}</span>

                                                <span style={detailLabelStyle()}>State</span>
                                                <span style={detailValueStyle()}>{runStateLabel(runEntry.state)}</span>

                                                <span style={detailLabelStyle()}>Status</span>
                                                <span style={detailValueStyle()}>{runEntry.statusText}</span>

                                                <span style={detailLabelStyle()}>Started</span>
                                                <span style={detailValueStyle()}>
                                                    {runEntry.startedAt ? formatDateTime(runEntry.startedAt) : "—"}
                                                </span>

                                                <span style={detailLabelStyle()}>Finished</span>
                                                <span style={detailValueStyle()}>
                                                    {runEntry.finishedAt ? formatDateTime(runEntry.finishedAt) : "—"}
                                                </span>

                                                <span style={detailLabelStyle()}>Duration</span>
                                                <span style={detailValueStyle()}>
                                                    {typeof runEntry.durationMs === "number"
                                                        ? `${runEntry.durationMs} ms`
                                                        : "—"}
                                                </span>

                                                <span style={detailLabelStyle()}>Error</span>
                                                <span style={detailValueStyle()}>
                                                    {runEntry.errorMessage
                                                        ? `${runEntry.errorKind ?? "error"}: ${runEntry.errorMessage}`
                                                        : "—"}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {visibleRequests.length === 0 && (
                                <div style={{ color: "var(--pg-text-muted)", fontSize: 13 }}>
                                    No result for this filter.
                                </div>
                            )}
                        </div>
                    )}
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
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                            {runSummary
                                ? `Total ${runSummary.total} • OK ${runSummary.success} • Failed ${runSummary.failed} • Cancelled ${runSummary.cancelled} • Skipped ${runSummary.skipped}`
                                : "No run yet."}
                        </div>
                        {runSummary?.cancelledByUser && (
                            <div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 700 }}>
                                Run was cancelled by user.
                            </div>
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

function runStateLabel(state: CollectionRunState): string {
    if (state === "queued") return "Queued";
    if (state === "running") return "Running";
    if (state === "success") return "OK";
    if (state === "failed") return "Failed";
    if (state === "cancelled") return "Cancelled";
    if (state === "skipped") return "Skipped";
    return "Idle";
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

function filterTabStyle(active: boolean): React.CSSProperties {
    return {
        ...buttonStyle(false),
        height: 30,
        padding: "0 10px",
        borderColor: active ? "var(--pg-primary)" : "var(--pg-border)",
        background: active ? "rgba(var(--pg-primary-rgb), 0.2)" : "var(--pg-surface-1)",
        color: active ? "var(--pg-primary)" : "var(--pg-text-dim)",
        fontWeight: 700,
        boxShadow: "none",
    };
}

function rowBorderStyle(state: CollectionRunState): string {
    if (state === "failed") return "1px solid var(--pg-danger)";
    if (state === "cancelled") return "1px solid #f59e0b";
    if (state === "success") return "1px solid rgba(16, 185, 129, 0.5)";
    if (state === "running") return "1px solid var(--pg-primary)";
    return "1px solid var(--pg-border)";
}

function runStatusBadgeStyle(state: CollectionRunState): React.CSSProperties {
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
