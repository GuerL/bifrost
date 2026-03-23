import type { CSSProperties, RefObject } from "react";

type FindBarProps = {
    query: string;
    activeMatchIndex: number;
    matchCount: number;
    onQueryChange: (next: string) => void;
    onPreviousMatch: () => void;
    onNextMatch: () => void;
    onClose: () => void;
    inputRef?: RefObject<HTMLInputElement | null>;
    placeholder?: string;
};

export default function FindBar({
    query,
    activeMatchIndex,
    matchCount,
    onQueryChange,
    onPreviousMatch,
    onNextMatch,
    onClose,
    inputRef,
    placeholder = "Find",
}: FindBarProps) {
    const hasQuery = query.trim().length > 0;
    const canNavigate = hasQuery && matchCount > 0;
    const countText = !canNavigate ? "0/0" : `${activeMatchIndex + 1}/${matchCount}`;

    return (
        <div style={findBarStyle()}>
            <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder={placeholder}
                style={findInputStyle()}
                spellCheck={false}
            />
            <div style={findCountStyle()}>{countText}</div>
            <button
                type="button"
                onClick={onPreviousMatch}
                disabled={!canNavigate}
                style={findButtonStyle(!canNavigate)}
                aria-label="Previous match"
                title="Previous match (Shift+Enter)"
            >
                ↑
            </button>
            <button
                type="button"
                onClick={onNextMatch}
                disabled={!canNavigate}
                style={findButtonStyle(!canNavigate)}
                aria-label="Next match"
                title="Next match (Enter)"
            >
                ↓
            </button>
            <button
                type="button"
                onClick={onClose}
                style={findButtonStyle(false)}
                aria-label="Close find"
                title="Close (Escape)"
            >
                ✕
            </button>
        </div>
    );
}

function findBarStyle(): CSSProperties {
    return {
        display: "flex",
        alignItems: "center",
        gap: 6,
        border: "1px solid var(--pg-border)",
        background: "var(--pg-surface-1)",
        borderRadius: 10,
        padding: 6,
    };
}

function findInputStyle(): CSSProperties {
    return {
        minWidth: 0,
        flex: 1,
        height: 28,
        borderRadius: 8,
        border: "1px solid var(--pg-border)",
        background: "var(--pg-surface-0)",
        color: "var(--pg-text)",
        fontSize: 12,
        padding: "0 8px",
        outline: "none",
    };
}

function findCountStyle(): CSSProperties {
    return {
        minWidth: 54,
        textAlign: "center",
        fontSize: 12,
        color: "var(--pg-text-muted)",
        fontVariantNumeric: "tabular-nums",
    };
}

function findButtonStyle(disabled: boolean): CSSProperties {
    return {
        width: 28,
        height: 28,
        borderRadius: 8,
        border: "1px solid var(--pg-border)",
        background: "var(--pg-surface-gradient)",
        color: "var(--pg-text)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        padding: 0,
        boxShadow: "none",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
    };
}
