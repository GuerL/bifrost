import KeyValueTable from "../KeyValueTable.tsx";
import type { Environment, KeyValue } from "../types.ts";

type EnvironmentsModalProps = {
    open: boolean;
    busy: boolean;
    error: string;
    environments: Environment[];
    activeEnvironmentId: string | null;
    selectedEnvironmentId: string | null;
    draftName: string;
    draftVars: KeyValue[];
    onClose: () => void;
    onCreate: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onPickEnvironment: (environmentId: string) => void;
    onDraftNameChange: (value: string) => void;
    onDraftVarsChange: (next: KeyValue[]) => void;
    onSetActive: () => void;
    onSave: () => void;
};

export default function EnvironmentsModal({
    open,
    busy,
    error,
    environments,
    activeEnvironmentId,
    selectedEnvironmentId,
    draftName,
    draftVars,
    onClose,
    onCreate,
    onDuplicate,
    onDelete,
    onPickEnvironment,
    onDraftNameChange,
    onDraftVarsChange,
    onSetActive,
    onSave,
}: EnvironmentsModalProps) {
    return (
        <>
            {open && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 1400,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                    }}
                    onMouseDown={onClose}
                >
                    <div
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 900,
                            height: "78vh",
                            maxHeight: 700,
                            border: "1px solid var(--pg-border)",
                            borderRadius: 12,
                            background: "var(--pg-surface-1)",
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <h3 style={{ margin: 0 }}>Environments</h3>
                            <button onClick={onClose} style={buttonStyle(busy)}>
                                Close
                            </button>
                        </div>

                        <div style={{ display: "flex", gap: 12, minHeight: 0, flex: 1 }}>
                            <div
                                style={{
                                    width: 260,
                                    display: "flex",
                                    flexDirection: "column",
                                    minHeight: 0,
                                    gap: 8,
                                }}
                            >
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button onClick={onCreate} style={buttonStyle(busy)}>+ New</button>
                                    <button
                                        onClick={onDuplicate}
                                        disabled={!selectedEnvironmentId || busy}
                                        style={buttonStyle(!selectedEnvironmentId || busy)}
                                    >
                                        Duplicate
                                    </button>
                                </div>
                                <button
                                    onClick={onDelete}
                                    disabled={!selectedEnvironmentId || busy}
                                    style={buttonStyle(!selectedEnvironmentId || busy)}
                                >
                                    Delete
                                </button>

                                <div style={{ overflowY: "auto", minHeight: 0, flex: 1, paddingRight: 4 }}>
                                    {environments.map((env) => (
                                        <button
                                            key={env.id}
                                            onClick={() => onPickEnvironment(env.id)}
                                            style={{
                                                ...buttonStyle(false),
                                                width: "100%",
                                                marginBottom: 6,
                                                textAlign: "left",
                                                borderColor: env.id === selectedEnvironmentId ? "var(--pg-primary)" : "var(--pg-border)",
                                            }}
                                        >
                                            {env.name}
                                            {env.id === activeEnvironmentId ? " (active)" : ""}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div
                                style={{
                                    flex: 1,
                                    display: "flex",
                                    flexDirection: "column",
                                    minHeight: 0,
                                    gap: 12,
                                }}
                            >
                                {!selectedEnvironmentId && (
                                    <div style={{ color: "var(--pg-text-muted)" }}>No environment selected.</div>
                                )}

                                {selectedEnvironmentId && (
                                    <>
                                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                            <span style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>Name</span>
                                            <input
                                                value={draftName}
                                                onChange={(e) => onDraftNameChange(e.target.value)}
                                                disabled={busy}
                                            />
                                        </label>

                                        <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                                            Use variables in requests with <code>{"{{variable_name}}"}</code>.
                                        </div>

                                        <div style={{ minHeight: 0, overflowY: "auto", flex: 1, paddingRight: 4 }}>
                                            <KeyValueTable rows={draftVars} onChange={onDraftVarsChange} />
                                        </div>

                                        {error && <div style={{ color: "var(--pg-danger)", fontSize: 13 }}>{error}</div>}

                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                            <button
                                                onClick={onSetActive}
                                                disabled={busy}
                                                style={buttonStyle(busy)}
                                            >
                                                Set Active
                                            </button>
                                            <button
                                                onClick={onSave}
                                                disabled={busy}
                                                style={primaryButtonStyle(busy)}
                                            >
                                                Save Environment
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function buttonStyle(disabled: boolean): React.CSSProperties {
    return {
        height: 34,
        padding: "0 12px",
        borderRadius: 10,
        border: "1px solid var(--pg-border)",
        background: disabled ? "var(--pg-surface-2)" : "var(--pg-surface-gradient)",
        color: disabled ? "var(--pg-disabled)" : "var(--pg-text)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 600,
        boxShadow: disabled ? "none" : "0 8px 20px rgba(2, 6, 23, 0.2)",
    };
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
    return {
        height: 34,
        padding: "0 14px",
        borderRadius: 10,
        border: "1px solid var(--pg-primary-strong)",
        background: disabled ? "rgba(var(--pg-primary-rgb), 0.45)" : "var(--pg-primary)",
        color: "var(--pg-primary-ink)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 700,
        boxShadow: disabled ? "none" : "0 10px 24px rgba(var(--pg-primary-rgb), 0.35)",
    };
}
