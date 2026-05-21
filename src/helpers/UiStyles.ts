import type { CSSProperties } from "react";

export function buttonStyle(disabled: boolean): CSSProperties {
    return {
        height: 28,
        padding: "0 10px",
        borderRadius: 7,
        border: "1px solid var(--pg-border)",
        background: disabled ? "var(--pg-surface-1)" : "var(--pg-surface-gradient)",
        color: disabled ? "var(--pg-disabled)" : "var(--pg-text)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 600,
        fontSize: 12,
        boxShadow: disabled ? "none" : "0 2px 8px var(--pg-shadow-color)",
    };
}

export function primaryButtonStyle(disabled: boolean): CSSProperties {
    return {
        height: 28,
        padding: "0 11px",
        borderRadius: 7,
        border: "1px solid var(--pg-primary-strong)",
        background: disabled ? "rgba(var(--pg-primary-rgb), 0.35)" : "var(--pg-primary)",
        color: "var(--pg-primary-ink)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 700,
        fontSize: 12,
        boxShadow: disabled ? "none" : "0 4px 12px rgba(var(--pg-primary-rgb), 0.24)",
    };
}

export function dangerButtonStyle(disabled: boolean): CSSProperties {
    return {
        height: 28,
        padding: "0 11px",
        borderRadius: 7,
        border: "1px solid var(--pg-danger)",
        background: disabled ? "var(--pg-danger-dark)" : "var(--pg-danger)",
        color: "var(--pg-text)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 600,
        fontSize: 12,
        boxShadow: disabled ? "none" : "0 4px 12px rgba(220, 38, 38, 0.2)",
    };
}

export function selectStyle(): CSSProperties {
    return {
        height: 28,
        borderRadius: 7,
        border: "1px solid var(--pg-border)",
        background: "var(--pg-surface-0)",
        color: "var(--pg-text)",
        padding: "0 10px",
        fontSize: 12,
    };
}

export function topbarSelectStyle(): CSSProperties {
    return {
        height: 28,
        minWidth: 170,
        borderRadius: 7,
        border: "1px solid var(--pg-border)",
        background: "var(--pg-surface-0)",
        color: "var(--pg-text)",
        padding: "0 9px",
        fontSize: 12,
        outline: "none",
    };
}

export function modalInputStyle(): CSSProperties {
    return {
        height: 34,
        borderRadius: 8,
        border: "1px solid var(--pg-border)",
        background: "var(--pg-surface-0)",
        color: "var(--pg-text)",
        padding: "0 12px",
        outline: "none",
    };
}

export function windowButtonStyle(
    color = "var(--pg-text)",
    borderColor = "var(--pg-border)"
): CSSProperties {
    return {
        width: 28,
        height: 26,
        borderRadius: 6,
        border: `1px solid ${borderColor}`,
        background: "var(--pg-surface-gradient)",
        color,
        cursor: "pointer",
        lineHeight: 1,
        padding: 0,
        fontSize: 12,
        boxShadow: "0 2px 8px var(--pg-shadow-color)",
    };
}

export function codeTextareaStyle(minHeight = 160): CSSProperties {
    return {
        width: "100%",
        minHeight,
        resize: "vertical",
        fontFamily: '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.5,
        borderRadius: 10,
        border: "1px solid var(--pg-border)",
        background: "var(--pg-editor-deep)",
        color: "var(--pg-text)",
        padding: "10px 12px",
        boxShadow: "inset 0 0 0 1px rgba(148, 163, 184, 0.08)",
        outline: "none",
    };
}
