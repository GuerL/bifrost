import { buttonStyle, dangerButtonStyle } from "../helpers/UiStyles.ts";

type ConfirmationModalProps = {
    open: boolean;
    busy: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    onCancel: () => void;
    onConfirm: () => void;
};

export default function ConfirmationModal({
    open,
    busy,
    title,
    message,
    confirmLabel,
    cancelLabel = "Cancel",
    onCancel,
    onConfirm,
}: ConfirmationModalProps) {
    if (!open) return null;

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 1450,
                background: "rgba(0,0,0,0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
            }}
            onMouseDown={() => {
                if (!busy) onCancel();
            }}
        >
            <div
                onMouseDown={(event) => event.stopPropagation()}
                style={{
                    width: "100%",
                    maxWidth: 500,
                    border: "1px solid var(--pg-border)",
                    borderRadius: 12,
                    background: "var(--pg-surface-1)",
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                }}
            >
                <h3 style={{ margin: 0 }}>{title}</h3>
                <div style={{ fontSize: 13, color: "var(--pg-text-dim)", lineHeight: 1.5 }}>
                    {message}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button onClick={onCancel} disabled={busy} style={buttonStyle(busy)}>
                        {cancelLabel}
                    </button>
                    <button onClick={onConfirm} disabled={busy} style={dangerButtonStyle(busy)}>
                        {busy ? "Deleting..." : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
