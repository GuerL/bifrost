import type { CSSProperties, RefObject } from "react";
import { buttonStyle } from "../helpers/UiStyles.ts";

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
    caseSensitive?: boolean;
    onToggleCaseSensitive?: () => void;
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
    caseSensitive = false,
    onToggleCaseSensitive,
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
            {onToggleCaseSensitive && (
                <button
                    type="button"
                    onClick={onToggleCaseSensitive}
                    style={findCaseButtonStyle(caseSensitive)}
                    aria-label="Toggle match case"
                    title="Match case"
                >
                    Aa
                </button>
            )}
        </div>
    );
}

function findBarStyle(): CSSProperties {
    return {
        display: "flex",
        alignItems: "center",
        gap: 6,
        border: "1px solid var(--pg-border-soft)",
        background: "var(--pg-surface-alt)",
        borderRadius: 10,
        padding: 7,
    };
}

function findInputStyle(): CSSProperties {
    return {
        minWidth: 0,
        flex: 1,
        height: 30,
        borderRadius: 8,
        border: "1px solid var(--pg-border-soft)",
        background: "var(--pg-control-bg)",
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
        ...buttonStyle(disabled),
        width: 30,
        height: 30,
        borderRadius: 8,
        color: disabled ? "var(--pg-disabled)" : "var(--pg-text)",
        opacity: disabled ? 0.5 : 1,
        padding: 0,
        boxShadow: "none",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
    };
}

function findCaseButtonStyle(active: boolean): CSSProperties {
    return {
        ...buttonStyle(false),
        minWidth: 36,
        height: 30,
        borderRadius: 8,
        border: active ? "1px solid var(--pg-tab-active-border)" : "1px solid var(--pg-border-soft)",
        background: active ? "var(--pg-tab-active-bg)" : "var(--pg-control-bg)",
        color: active ? "var(--pg-text)" : "var(--pg-text)",
        cursor: "pointer",
        padding: "0 8px",
        boxShadow: "none",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
    };
}
