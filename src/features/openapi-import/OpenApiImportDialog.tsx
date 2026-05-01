import { buttonStyle, primaryButtonStyle } from "../../helpers/UiStyles.ts";
import type { OpenApiImportPreview } from "./openApiTypes.ts";

type OpenApiImportDialogProps = {
    fileName: string;
    collectionName: string;
    preview: OpenApiImportPreview;
    warnings: string[];
    error: string;
    busy: boolean;
    onCancel: () => void;
    onConfirm: () => void;
};

export default function OpenApiImportDialog({
    fileName,
    collectionName,
    preview,
    warnings,
    error,
    busy,
    onCancel,
    onConfirm,
}: OpenApiImportDialogProps) {
    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 1460,
                background: "rgba(0,0,0,0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
            }}
            onMouseDown={() => {
                if (!busy) {
                    onCancel();
                }
            }}
        >
            <div
                onMouseDown={(event) => event.stopPropagation()}
                style={{
                    width: "100%",
                    maxWidth: 640,
                    border: "1px solid var(--pg-border)",
                    borderRadius: 12,
                    background: "var(--pg-surface-1)",
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                }}
            >
                <h3 style={{ margin: 0 }}>Import OpenAPI / Swagger</h3>
                <div style={{ fontSize: 13, color: "var(--pg-text-dim)", lineHeight: 1.5 }}>
                    Review the generated collection before importing.
                </div>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "190px 1fr",
                        gap: "6px 10px",
                        fontSize: 13,
                    }}
                >
                    <span style={{ color: "var(--pg-text-muted)" }}>Source file</span>
                    <span>{fileName}</span>
                    <span style={{ color: "var(--pg-text-muted)" }}>Collection</span>
                    <span>{collectionName}</span>
                    <span style={{ color: "var(--pg-text-muted)" }}>API title</span>
                    <span>{preview.title || "-"}</span>
                    <span style={{ color: "var(--pg-text-muted)" }}>Version</span>
                    <span>{preview.version || "-"}</span>
                    <span style={{ color: "var(--pg-text-muted)" }}>Detected server URL</span>
                    <span style={{ wordBreak: "break-all" }}>{preview.serverUrl || "-"}</span>
                    <span style={{ color: "var(--pg-text-muted)" }}>Paths</span>
                    <span>{preview.pathCount}</span>
                    <span style={{ color: "var(--pg-text-muted)" }}>Generated requests</span>
                    <span>{preview.requestCount}</span>
                </div>
                {warnings.length > 0 && (
                    <div
                        style={{
                            border: "1px solid var(--pg-border)",
                            borderRadius: 10,
                            padding: "10px 12px",
                            display: "grid",
                            gap: 4,
                            fontSize: 12,
                            color: "var(--pg-text-dim)",
                            maxHeight: 150,
                            overflowY: "auto",
                        }}
                    >
                        {warnings.map((warning, index) => (
                            <div key={`${warning}-${index}`}>• {warning}</div>
                        ))}
                    </div>
                )}
                {error && (
                    <div style={{ color: "var(--pg-danger)", fontSize: 13 }}>
                        {error}
                    </div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button onClick={onCancel} disabled={busy} style={buttonStyle(busy)}>
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={busy || preview.requestCount === 0}
                        style={primaryButtonStyle(busy || preview.requestCount === 0)}
                    >
                        {busy ? "Importing..." : "Import"}
                    </button>
                </div>
            </div>
        </div>
    );
}

