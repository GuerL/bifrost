import { useMemo, useState } from "react";
import KeyValueTable from "../KeyValueTable.tsx";
import type { Environment, KeyValue } from "../types.ts";
import ConfirmationModal from "./ConfirmationModal.tsx";
import AppSelect, { type AppSelectOption } from "./AppSelect.tsx";
import {
    buttonStyle,
    dangerButtonStyle,
    modalInputStyle,
    primaryButtonStyle,
} from "../helpers/UiStyles.ts";

type DeleteEnvironmentTarget = {
    id: string;
    name: string;
};

const ENV_ACTION_PLACEHOLDER = "__env_actions__";

type EnvironmentsModalProps = {
    open: boolean;
    busy: boolean;
    error: string;
    environments: Environment[];
    activeEnvironmentId: string | null;
    selectedEnvironmentId: string | null;
    draftName: string;
    draftVars: KeyValue[];
    deleteTarget: DeleteEnvironmentTarget | null;
    onClose: () => void;
    onCreate: () => void;
    onDuplicate: () => void;
    onImport: () => void;
    onExport: () => void;
    onRequestDelete: () => void;
    onPickEnvironment: (environmentId: string) => void;
    onDraftNameChange: (value: string) => void;
    onDraftVarsChange: (next: KeyValue[]) => void;
    onSetActive: () => void;
    onSave: () => void;
    onCancelDelete: () => void;
    onConfirmDelete: () => void;
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
    deleteTarget,
    onClose,
    onCreate,
    onDuplicate,
    onImport,
    onExport,
    onRequestDelete,
    onPickEnvironment,
    onDraftNameChange,
    onDraftVarsChange,
    onSetActive,
    onSave,
    onCancelDelete,
    onConfirmDelete,
}: EnvironmentsModalProps) {
    const [headerAction, setHeaderAction] = useState<string>(ENV_ACTION_PLACEHOLDER);

    const headerActionOptions = useMemo<AppSelectOption[]>(
        () => [
            {
                value: ENV_ACTION_PLACEHOLDER,
                label: "Manage",
                disabled: true,
            },
            {
                value: "new",
                label: "New Environment",
                disabled: busy,
            },
            {
                value: "duplicate",
                label: "Duplicate Environment",
                disabled: busy || !selectedEnvironmentId,
            },
            {
                value: "import",
                label: "Import Environment",
                disabled: busy,
            },
            {
                value: "export",
                label: "Export Environment",
                disabled: busy || !selectedEnvironmentId,
            },
        ],
        [busy, selectedEnvironmentId]
    );

    function onHeaderAction(nextValue: string) {
        setHeaderAction(ENV_ACTION_PLACEHOLDER);

        if (nextValue === "new") {
            onCreate();
            return;
        }
        if (nextValue === "duplicate") {
            onDuplicate();
            return;
        }
        if (nextValue === "import") {
            onImport();
            return;
        }
        if (nextValue === "export") {
            onExport();
        }
    }

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
                            height: "70vh",
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
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <AppSelect
                                    value={headerAction}
                                    options={headerActionOptions}
                                    onValueChange={onHeaderAction}
                                    ariaLabel="Environment actions"
                                    style={{ minWidth: 192 }}
                                />
                                <button onClick={onClose} style={buttonStyle(busy)}>
                                    Close
                                </button>
                            </div>
                        </div>

                        <div style={{ display: "flex", gap: 12, minHeight: 0, flex: 1 }}>
                            <div
                                style={{
                                    width: 260,
                                    display: "flex",
                                    flexDirection: "column",
                                    minHeight: 0,
                                }}
                            >
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
                                                style={modalInputStyle()}
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
                                            <div style={{ display: "flex", gap: 8 }}>
                                                <button
                                                    onClick={onRequestDelete}
                                                    disabled={busy}
                                                    style={dangerButtonStyle(busy)}
                                                >
                                                    Delete Environment
                                                </button>
                                                <button
                                                    onClick={onSave}
                                                    disabled={busy}
                                                    style={primaryButtonStyle(busy)}
                                                >
                                                    Save Environment
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmationModal
                open={!!deleteTarget}
                busy={busy}
                title="Delete environment"
                message={
                    deleteTarget
                        ? `Delete "${deleteTarget.name}"? Variables stored in this environment will be removed.`
                        : ""
                }
                confirmLabel="Delete"
                onCancel={onCancelDelete}
                onConfirm={onConfirmDelete}
            />
        </>
    );
}
