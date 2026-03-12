import type { CSSProperties } from "react";

export function buttonStyle(disabled: boolean): CSSProperties {
    return {
        height: 34,
        padding: "0 12px",
        borderRadius: 10,
        border: "1px solid var(--pg-border)",
        background: disabled ? "var(--pg-surface-2)" : "var(--pg-surface-gradient)",
        color: disabled ? "var(--pg-disabled)" : "var(--pg-text)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 600,
        boxShadow: disabled ? "none" : "0 8px 20px rgba(2, 6, 23, 0.2)",
    };
}

export function primaryButtonStyle(disabled: boolean): CSSProperties {
    return {
        height: 34,
        padding: "0 14px",
        borderRadius: 10,
        border: "1px solid var(--pg-primary-strong)",
        background: disabled ? "rgba(var(--pg-primary-rgb), 0.45)" : "var(--pg-primary)",
        color: "var(--pg-primary-ink)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 700,
        boxShadow: disabled ? "none" : "0 10px 24px rgba(var(--pg-primary-rgb), 0.35)",
    };
}

export function dangerButtonStyle(disabled: boolean): CSSProperties {
    return {
        height: 34,
        padding: "0 14px",
        borderRadius: 10,
        border: "1px solid var(--pg-danger)",
        background: disabled ? "var(--pg-danger-dark)" : "var(--pg-danger)",
        color: "var(--pg-text)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 600,
        boxShadow: disabled ? "none" : "0 10px 24px rgba(220, 38, 38, 0.25)",
    };
}

export function selectStyle(): CSSProperties {
    return {
        height: 34,
        borderRadius: 10,
        border: "1px solid var(--pg-border)",
        background: "var(--pg-surface-0)",
        color: "var(--pg-text)",
        padding: "0 12px",
    };
}

export function topbarSelectStyle(): CSSProperties {
    return {
        height: 34,
        minWidth: 180,
        borderRadius: 10,
        border: "1px solid var(--pg-border)",
        background: "var(--pg-surface-0)",
        color: "var(--pg-text)",
        padding: "0 10px",
        outline: "none",
    };
}

export function modalInputStyle(): CSSProperties {
    return {
        height: 36,
        borderRadius: 10,
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
        width: 32,
        height: 30,
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        background: "var(--pg-surface-gradient)",
        color,
        cursor: "pointer",
        lineHeight: 1,
        padding: 0,
        boxShadow: "0 8px 20px rgba(2, 6, 23, 0.2)",
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
