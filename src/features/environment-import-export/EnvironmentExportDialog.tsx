import { useEffect, useMemo, useState } from "react";
import type { Environment, KeyValue } from "../../types.ts";
import {
    buttonStyle,
    primaryButtonStyle,
    selectStyle,
} from "../../helpers/UiStyles.ts";
import {
    buildEnvironmentExportPayload,
    buildEnvironmentExportVariables,
} from "./environmentExport.ts";

export type EnvironmentExportSubmission = {
    environment: Environment;
    variables: KeyValue[];
};

type EnvironmentExportDialogProps = {
    open: boolean;
    busy: boolean;
    environments: Environment[];
    initialEnvironmentId: string | null;
    onClose: () => void;
    onExport: (submission: EnvironmentExportSubmission) => void;
};

export default function EnvironmentExportDialog({
    open,
    busy,
    environments,
    initialEnvironmentId,
    onClose,
    onExport,
}: EnvironmentExportDialogProps) {
    const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(null);
    const [selectedVariableKeys, setSelectedVariableKeys] = useState<string[]>([]);
    const [hideValues, setHideValues] = useState(true);

    useEffect(() => {
        if (!open) {
            return;
        }

        const preferred =
            environments.find((environment) => environment.id === initialEnvironmentId) ??
            environments[0] ??
            null;

        setSelectedEnvironmentId(preferred?.id ?? null);
    }, [open, environments, initialEnvironmentId]);

    const selectedEnvironment = useMemo(
        () =>
            environments.find((environment) => environment.id === selectedEnvironmentId) ??
            null,
        [environments, selectedEnvironmentId]
    );

    const exportVariables = useMemo(
        () =>
            selectedEnvironment
                ? buildEnvironmentExportVariables(selectedEnvironment)
                : [],
        [selectedEnvironment]
    );

    useEffect(() => {
        if (!selectedEnvironment) {
            setSelectedVariableKeys([]);
            return;
        }

        const defaultSelected = exportVariables
            .filter((variable) => variable.selectedByDefault)
            .map((variable) => variable.key);
        setSelectedVariableKeys(defaultSelected);
        setHideValues(true);
    }, [selectedEnvironment, exportVariables]);

    const selectedVariableKeySet = useMemo(
        () => new Set(selectedVariableKeys),
        [selectedVariableKeys]
    );

    const selectedVariables = useMemo(
        () =>
            exportVariables
                .filter((variable) => selectedVariableKeySet.has(variable.key))
                .map((variable) => ({ key: variable.key, value: variable.value })),
        [exportVariables, selectedVariableKeySet]
    );

    const exportPreview = useMemo(() => {
        if (!selectedEnvironment) {
            return "";
        }

        const payload = buildEnvironmentExportPayload(
            selectedEnvironment.name,
            selectedVariables
        );

        if (!hideValues) {
            return JSON.stringify(payload, null, 2);
        }

        const sensitiveKeys = new Set(
            exportVariables
                .filter((variable) => variable.sensitive)
                .map((variable) => variable.key)
        );

        const maskedVariables = Object.entries(payload.environment.variables).reduce<
            Record<string, string>
        >((acc, [key, value]) => {
            acc[key] = sensitiveKeys.has(key) ? "••••••" : value;
            return acc;
        }, {});

        return JSON.stringify(
            {
                ...payload,
                environment: {
                    ...payload.environment,
                    variables: maskedVariables,
                },
            },
            null,
            2
        );
    }, [selectedEnvironment, selectedVariables, hideValues, exportVariables]);

    if (!open) {
        return null;
    }

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 1465,
                background: "rgba(0,0,0,0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
            }}
            onMouseDown={() => {
                if (!busy) {
                    onClose();
                }
            }}
        >
            <div
                onMouseDown={(event) => event.stopPropagation()}
                style={{
                    width: "100%",
                    maxWidth: 720,
                    maxHeight: "82vh",
                    border: "1px solid var(--pg-border)",
                    borderRadius: 12,
                    background: "var(--pg-surface-1)",
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                }}
            >
                <h3 style={{ margin: 0 }}>Export Environment</h3>

                <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                    <span style={{ color: "var(--pg-text-muted)" }}>Environment</span>
                    <select
                        value={selectedEnvironmentId ?? ""}
                        onChange={(event) => setSelectedEnvironmentId(event.target.value || null)}
                        disabled={busy || environments.length === 0}
                        style={selectStyle()}
                    >
                        {environments.map((environment) => (
                            <option key={environment.id} value={environment.id}>
                                {environment.name}
                            </option>
                        ))}
                    </select>
                </label>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                        Variables to export ({selectedVariables.length}/{exportVariables.length})
                    </span>
                    <label
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 12,
                            color: "var(--pg-text-muted)",
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={hideValues}
                            onChange={(event) => setHideValues(event.target.checked)}
                            disabled={busy}
                        />
                        Hide sensitive preview values
                    </label>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                    <button
                        type="button"
                        onClick={() =>
                            setSelectedVariableKeys(exportVariables.map((variable) => variable.key))
                        }
                        disabled={busy || exportVariables.length === 0}
                        style={buttonStyle(busy || exportVariables.length === 0)}
                    >
                        Select All
                    </button>
                    <button
                        type="button"
                        onClick={() => setSelectedVariableKeys([])}
                        disabled={busy || exportVariables.length === 0}
                        style={buttonStyle(busy || exportVariables.length === 0)}
                    >
                        Deselect All
                    </button>
                </div>

                <div
                    style={{
                        border: "1px solid var(--pg-border)",
                        borderRadius: 10,
                        padding: "8px 10px",
                        minHeight: 120,
                        maxHeight: 180,
                        overflowY: "auto",
                        display: "grid",
                        gap: 6,
                    }}
                >
                    {exportVariables.length === 0 && (
                        <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                            No variables available.
                        </div>
                    )}

                    {exportVariables.map((variable) => (
                        <label
                            key={variable.key}
                            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
                        >
                            <input
                                type="checkbox"
                                checked={selectedVariableKeySet.has(variable.key)}
                                onChange={(event) => {
                                    if (event.target.checked) {
                                        setSelectedVariableKeys((prev) => [...prev, variable.key]);
                                        return;
                                    }
                                    setSelectedVariableKeys((prev) =>
                                        prev.filter((key) => key !== variable.key)
                                    );
                                }}
                                disabled={busy}
                            />
                            <span>{variable.key}</span>
                            {variable.sensitive && (
                                <span style={{ color: "var(--pg-warning)", fontSize: 12 }}>
                                    🔒 Sensitive
                                </span>
                            )}
                        </label>
                    ))}
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>Export preview</span>
                    <pre
                        style={{
                            margin: 0,
                            border: "1px solid var(--pg-border)",
                            borderRadius: 10,
                            background: "var(--pg-surface-0)",
                            padding: "10px 12px",
                            overflow: "auto",
                            maxHeight: 220,
                            fontSize: 12,
                            lineHeight: 1.45,
                        }}
                    >
                        {exportPreview}
                    </pre>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button onClick={onClose} disabled={busy} style={buttonStyle(busy)}>
                        Cancel
                    </button>
                    <button
                        onClick={() => {
                            if (!selectedEnvironment) {
                                return;
                            }
                            onExport({
                                environment: selectedEnvironment,
                                variables: selectedVariables,
                            });
                        }}
                        disabled={busy || !selectedEnvironment}
                        style={primaryButtonStyle(busy || !selectedEnvironment)}
                    >
                        {busy ? "Exporting..." : "Export"}
                    </button>
                </div>
            </div>
        </div>
    );
}
