import { useEffect } from "react";
import { buttonStyle, primaryButtonStyle } from "../helpers/UiStyles.ts";

type NoCollectionsModalProps = {
    open: boolean;
    onClose: () => void;
    onOpenCollections: () => void;
};

export default function NoCollectionsModal({
    open,
    onClose,
    onOpenCollections,
}: NoCollectionsModalProps) {
    useEffect(() => {
        if (!open) return;

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
            }

            if (event.key === "Enter") {
                event.preventDefault();
                onOpenCollections();
            }
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onClose, onOpenCollections]);

    if (!open) return null;

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
                    maxWidth: 520,
                    border: "1px solid var(--pg-border)",
                    borderRadius: 12,
                    background: "var(--pg-surface-1)",
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                }}
            >
                <h3 style={{ margin: 0 }}>No collections yet</h3>
                <div style={{ fontSize: 13, color: "var(--pg-text-muted)", lineHeight: 1.5 }}>
                    You need to create a collection before creating your first request.
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button onClick={onClose} style={buttonStyle(false)}>
                        Later
                    </button>
                    <button onClick={onOpenCollections} style={primaryButtonStyle(false)}>
                        Open Collections
                    </button>
                </div>
            </div>
        </div>
    );
}
