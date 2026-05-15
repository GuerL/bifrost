import { useEffect, useMemo, useState } from "react";
import type { Environment } from "../../types.ts";
import {
    buttonStyle,
    modalInputStyle,
    primaryButtonStyle,
} from "../../helpers/UiStyles.ts";
import {
    buildEnvironmentImportPlan,
    findEnvironmentByName,
    listVariableConflicts,
} from "./environmentImport.ts";
import type {
    EnvironmentConflictStrategy,
    ParsedBifrostEnvironmentImport,
    VariableConflictStrategy,
} from "./environmentImportExportTypes.ts";

export type EnvironmentImportSubmission = {
    selectedVariableKeys: string[];
    environmentConflictStrategy: EnvironmentConflictStrategy;
    variableConflictStrategy: VariableConflictStrategy;
    renamedEnvironmentName: string;
};

type EnvironmentImportDialogProps = {
    open: boolean;
    busy: boolean;
    error: string;
    parsedImport: ParsedBifrostEnvironmentImport | null;
    sourcePath: string | null;
    existingEnvironments: Environment[];
    onClose: () => void;
    onImport: (submission: EnvironmentImportSubmission) => void;
};

function fileNameFromPath(path: string | null): string {
    if (!path) {
        return "-";
    }

    const normalized = path.replace(/\\/g, "/");
    const parts = normalized.split("/");
    return parts[parts.length - 1] || path;
}

export default function EnvironmentImportDialog({
    open,
    busy,
    error,
    parsedImport,
    sourcePath,
    existingEnvironments,
    onClose,
    onImport,
}: EnvironmentImportDialogProps) {
    const [selectedVariableKeys, setSelectedVariableKeys] = useState<string[]>([]);
    const [environmentConflictStrategy, setEnvironmentConflictStrategy] =
        useState<EnvironmentConflictStrategy>("merge");
    const [variableConflictStrategy, setVariableConflictStrategy] =
        useState<VariableConflictStrategy>("overwrite");
    const [renamedEnvironmentName, setRenamedEnvironmentName] = useState("");
    const [hideValues, setHideValues] = useState(true);

    useEffect(() => {
        if (!open || !parsedImport) {
            return;
        }

        setSelectedVariableKeys(
            parsedImport.environment.variables.map((variable) => variable.key)
        );
        setEnvironmentConflictStrategy("merge");
        setVariableConflictStrategy("overwrite");
        setRenamedEnvironmentName(`${parsedImport.environment.name} Imported`);
        setHideValues(true);
    }, [open, parsedImport]);

    const selectedVariableKeySet = useMemo(
        () => new Set(selectedVariableKeys),
        [selectedVariableKeys]
    );

    const matchingEnvironment = useMemo(() => {
        if (!parsedImport) {
            return null;
        }
        return findEnvironmentByName(existingEnvironments, parsedImport.environment.name);
    }, [existingEnvironments, parsedImport]);

    const selectedVariables = useMemo(() => {
        if (!parsedImport) {
            return [];
        }

        return parsedImport.environment.variables.filter((variable) =>
            selectedVariableKeySet.has(variable.key)
        );
    }, [parsedImport, selectedVariableKeySet]);

    const variableConflicts = useMemo(() => {
        if (!matchingEnvironment || environmentConflictStrategy !== "merge") {
            return [];
        }

        return listVariableConflicts(
            matchingEnvironment.variables,
            selectedVariables.map((variable) => ({ key: variable.key, value: variable.value }))
        );
    }, [matchingEnvironment, environmentConflictStrategy, selectedVariables]);

    const renameNameTaken = useMemo(() => {
        if (environmentConflictStrategy !== "rename") {
            return false;
        }

        const renamed = renamedEnvironmentName.trim();
        if (!renamed) {
            return false;
        }

        return !!findEnvironmentByName(existingEnvironments, renamed);
    }, [environmentConflictStrategy, renamedEnvironmentName, existingEnvironments]);

    const importPlanPreview = useMemo(() => {
        if (!parsedImport) {
            return null;
        }

        try {
            return buildEnvironmentImportPlan({
                parsedImport,
                existingEnvironments,
                selectedVariableKeys,
                environmentConflictStrategy,
                variableConflictStrategy,
                renamedEnvironmentName,
            });
        } catch {
            return null;
        }
    }, [
        parsedImport,
        existingEnvironments,
        selectedVariableKeys,
        environmentConflictStrategy,
        variableConflictStrategy,
        renamedEnvironmentName,
    ]);

    if (!open || !parsedImport) {
        return null;
    }

    const renameNameMissing =
        environmentConflictStrategy === "rename" && !renamedEnvironmentName.trim();

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
                    maxWidth: 760,
                    maxHeight: "84vh",
                    border: "1px solid var(--pg-border)",
                    borderRadius: 12,
                    background: "var(--pg-surface-1)",
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                }}
            >
                <h3 style={{ margin: 0 }}>Import Environment</h3>

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "170px 1fr",
                        gap: "6px 10px",
                        fontSize: 13,
                    }}
                >
                    <span style={{ color: "var(--pg-text-muted)" }}>Source file</span>
                    <span>{fileNameFromPath(sourcePath)}</span>
                    <span style={{ color: "var(--pg-text-muted)" }}>Detected environment</span>
                    <span>{parsedImport.environment.name}</span>
                </div>

                {matchingEnvironment && (
                    <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                            An environment with this name already exists.
                        </div>

                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                            <input
                                type="radio"
                                name="env-conflict-strategy"
                                checked={environmentConflictStrategy === "merge"}
                                onChange={() => setEnvironmentConflictStrategy("merge")}
                                disabled={busy}
                            />
                            Merge into existing environment
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                            <input
                                type="radio"
                                name="env-conflict-strategy"
                                checked={environmentConflictStrategy === "duplicate"}
                                onChange={() => setEnvironmentConflictStrategy("duplicate")}
                                disabled={busy}
                            />
                            Create duplicate environment
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                            <input
                                type="radio"
                                name="env-conflict-strategy"
                                checked={environmentConflictStrategy === "rename"}
                                onChange={() => setEnvironmentConflictStrategy("rename")}
                                disabled={busy}
                            />
                            Rename imported environment
                        </label>

                        {environmentConflictStrategy === "rename" && (
                            <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                                <span style={{ color: "var(--pg-text-muted)" }}>New environment name</span>
                                <input
                                    value={renamedEnvironmentName}
                                    onChange={(event) => setRenamedEnvironmentName(event.target.value)}
                                    disabled={busy}
                                    style={modalInputStyle()}
                                />
                            </label>
                        )}
                    </div>
                )}

                {!matchingEnvironment && (
                    <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                        This will create a new environment named "{parsedImport.environment.name}".
                    </div>
                )}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                        Variables ({selectedVariables.length}/{parsedImport.environment.variables.length})
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
                        Hide sensitive values
                    </label>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                    <button
                        type="button"
                        onClick={() =>
                            setSelectedVariableKeys(
                                parsedImport.environment.variables.map((variable) => variable.key)
                            )
                        }
                        disabled={busy || parsedImport.environment.variables.length === 0}
                        style={buttonStyle(busy || parsedImport.environment.variables.length === 0)}
                    >
                        Select All
                    </button>
                    <button
                        type="button"
                        onClick={() => setSelectedVariableKeys([])}
                        disabled={busy || parsedImport.environment.variables.length === 0}
                        style={buttonStyle(busy || parsedImport.environment.variables.length === 0)}
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
                    {parsedImport.environment.variables.map((variable) => (
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
                            <span
                                style={{
                                    marginLeft: "auto",
                                    color: "var(--pg-text-dim)",
                                    fontFamily:
                                        '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace',
                                    fontSize: 12,
                                }}
                            >
                                {hideValues && variable.sensitive ? "••••••" : variable.value}
                            </span>
                        </label>
                    ))}
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                        Conflict strategy
                    </span>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <input
                            type="radio"
                            name="variable-conflict-strategy"
                            checked={variableConflictStrategy === "overwrite"}
                            onChange={() => setVariableConflictStrategy("overwrite")}
                            disabled={busy || variableConflicts.length === 0}
                        />
                        Overwrite existing
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <input
                            type="radio"
                            name="variable-conflict-strategy"
                            checked={variableConflictStrategy === "skip"}
                            onChange={() => setVariableConflictStrategy("skip")}
                            disabled={busy || variableConflicts.length === 0}
                        />
                        Skip existing
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <input
                            type="radio"
                            name="variable-conflict-strategy"
                            checked={variableConflictStrategy === "rename"}
                            onChange={() => setVariableConflictStrategy("rename")}
                            disabled={busy || variableConflicts.length === 0}
                        />
                        Rename duplicates
                    </label>
                    {variableConflicts.length > 0 && (
                        <div style={{ fontSize: 12, color: "var(--pg-text-dim)" }}>
                            Conflicts: {variableConflicts.join(", ")}
                        </div>
                    )}
                </div>

                {importPlanPreview && (
                    <div style={{ fontSize: 12, color: "var(--pg-text-dim)" }}>
                        Import target: {importPlanPreview.targetEnvironmentName} • Variables after import: {importPlanPreview.variables.length}
                    </div>
                )}

                {(renameNameMissing || renameNameTaken) && (
                    <div style={{ fontSize: 13, color: "var(--pg-danger)" }}>
                        {renameNameMissing
                            ? "Please enter a name for the imported environment."
                            : "An environment with this name already exists."}
                    </div>
                )}

                {error && <div style={{ fontSize: 13, color: "var(--pg-danger)" }}>{error}</div>}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button onClick={onClose} disabled={busy} style={buttonStyle(busy)}>
                        Cancel
                    </button>
                    <button
                        onClick={() =>
                            onImport({
                                selectedVariableKeys,
                                environmentConflictStrategy,
                                variableConflictStrategy,
                                renamedEnvironmentName,
                            })
                        }
                        disabled={busy || renameNameMissing || renameNameTaken}
                        style={primaryButtonStyle(busy || renameNameMissing || renameNameTaken)}
                    >
                        {busy ? "Importing..." : "Import"}
                    </button>
                </div>
            </div>
        </div>
    );
}
