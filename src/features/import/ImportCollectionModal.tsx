import { useEffect, useRef } from "react";

export type ImportCollectionOption = {
    id: string;
    label: string;
    description: string;
    disabled?: boolean;
    onSelect: () => void;
};

type ImportCollectionModalProps = {
    open: boolean;
    busy?: boolean;
    options: ImportCollectionOption[];
    onCancel: () => void;
};

export default function ImportCollectionModal({
    open,
    busy = false,
    options,
    onCancel,
}: ImportCollectionModalProps) {
    const firstEnabledOptionRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const raf = window.requestAnimationFrame(() => {
            firstEnabledOptionRef.current?.focus();
        });
        return () => window.cancelAnimationFrame(raf);
    }, [open]);

    useEffect(() => {
        if (!open) return;

        function onKeyDown(event: KeyboardEvent) {
            if (event.key !== "Escape") return;
            if (busy) return;
            event.preventDefault();
            onCancel();
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, busy, onCancel]);

    if (!open) {
        return null;
    }

    let firstEnabledRendered = false;

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 1455,
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
                role="dialog"
                aria-modal
                aria-labelledby="import-collection-title"
                onMouseDown={(event) => event.stopPropagation()}
                style={{
                    width: "100%",
                    maxWidth: 760,
                    border: "1px solid var(--pg-border)",
                    borderRadius: 12,
                    background: "var(--pg-surface-1)",
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <h3 id="import-collection-title" style={{ margin: 0 }}>
                        Import Collection
                    </h3>
                    <button
                        type="button"
                        aria-label="Close import modal"
                        title="Close"
                        disabled={busy}
                        onClick={onCancel}
                        style={{
                            width: 26,
                            height: 26,
                            borderRadius: 6,
                            border: "1px solid var(--pg-border)",
                            background: "var(--pg-surface-0)",
                            color: busy ? "var(--pg-disabled)" : "var(--pg-text-dim)",
                            cursor: busy ? "not-allowed" : "pointer",
                            display: "grid",
                            placeItems: "center",
                            padding: 0,
                        }}
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden
                        >
                            <path
                                d="M6 6L18 18M18 6L6 18"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                            />
                        </svg>
                    </button>
                </div>
                <div style={{ fontSize: 13, color: "var(--pg-text-dim)", lineHeight: 1.5 }}>
                    Choose a source format.
                </div>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                        gap: 10,
                    }}
                >
                    {options.map((option) => {
                        const disabled = busy || option.disabled === true;
                        const attachFirstRef = !disabled && !firstEnabledRendered;
                        if (attachFirstRef) {
                            firstEnabledRendered = true;
                        }

                        return (
                            <button
                                key={option.id}
                                ref={attachFirstRef ? firstEnabledOptionRef : null}
                                type="button"
                                onClick={() => option.onSelect()}
                                disabled={disabled}
                                style={{
                                    minHeight: 82,
                                    borderRadius: 10,
                                    border: "1px solid var(--pg-border)",
                                    background: disabled
                                        ? "var(--pg-surface-2)"
                                        : "var(--pg-surface-0)",
                                    color: disabled ? "var(--pg-disabled)" : "var(--pg-text)",
                                    textAlign: "left",
                                    padding: "10px 12px",
                                    display: "grid",
                                    gap: 5,
                                    cursor: disabled ? "not-allowed" : "pointer",
                                }}
                            >
                                <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>
                                    {option.label}
                                </span>
                                <span
                                    style={{
                                        fontSize: 12,
                                        color: disabled ? "var(--pg-disabled)" : "var(--pg-text-dim)",
                                        lineHeight: 1.4,
                                    }}
                                >
                                    {option.description}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
