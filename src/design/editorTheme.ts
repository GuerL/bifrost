import type { CSSProperties } from "react";
import type * as MonacoApi from "monaco-editor";
import "./editor-theme.css";

export type EditorMode = "light" | "dark";
export const editorThemeName = (mode: EditorMode) =>
    mode === "light" ? "bifrost-daylight" : "bifrost-midnight";

/** Monaco accepts hex colors, so resolve the existing CSS roles at registration. */
export function editorColorToHex(value: string): string {
    const color = value.trim();
    if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(color)) return color;
    if (/^#[\da-f]{3,4}$/i.test(color)) {
        return `#${color.slice(1).split("").map((part) => part + part).join("")}`;
    }
    const rgb = color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
    if (!rgb) throw new Error(`Unresolved editor color: ${value}`);
    const channels = rgb.slice(1, 4).map(Number);
    if (rgb[4] !== undefined) channels.push(Number(rgb[4]) * 255);
    return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

export function createEditorTheme(
    mode: EditorMode,
    readColor: (role: string) => string,
): MonacoApi.editor.IStandaloneThemeData {
    const color = (role: string) => editorColorToHex(readColor(`--bf-editor-${role}`));
    const token = (role: string) => color(role).slice(1);
    return {
        base: mode === "light" ? "vs" : "vs-dark",
        inherit: true,
        rules: [
            { token: "", foreground: token("foreground") },
            { token: "comment", foreground: token("muted") },
            { token: "keyword", foreground: token("keyword") },
            { token: "keyword.js", foreground: token("keyword") },
            { token: "number", foreground: token("number") },
            { token: "number.js", foreground: token("number") },
            { token: "string", foreground: token("string") },
            { token: "string.key.json", foreground: token("key") },
            { token: "string.value.json", foreground: token("string") },
            { token: "number.json", foreground: token("number") },
            { token: "keyword.json", foreground: token("boolean") },
            { token: "delimiter", foreground: token("foreground") },
        ],
        colors: {
            "editor.background": color("background"),
            "editor.foreground": color("foreground"),
            "editorGutter.background": color("background"),
            "editorStickyScroll.background": color("background"),
            "editorOverviewRuler.background": color("background"),
            "editorLineNumber.foreground": color("muted"),
            "editorLineNumber.activeForeground": color("foreground"),
            "editorCursor.foreground": color("focus"),
            "editor.selectionBackground": color("selection"),
            "editor.selectionForeground": color("foreground"),
            "editor.inactiveSelectionBackground": color("selection-inactive"),
            "editor.selectionHighlightBackground": color("selection-inactive"),
            "editor.lineHighlightBackground": color("line"),
            "editor.lineHighlightBorder": "#00000000",
            "editorIndentGuide.background1": color("guide"),
            "editorIndentGuide.activeBackground1": color("guide-active"),
            "editorWidget.background": color("background"),
            "editorWidget.foreground": color("foreground"),
            "editorWidget.border": color("border"),
            "editorSuggestWidget.background": color("background"),
            "editorSuggestWidget.foreground": color("foreground"),
            "editorSuggestWidget.border": color("border"),
            "editorSuggestWidget.selectedBackground": color("selection"),
            "editorHoverWidget.background": color("background"),
            "editorHoverWidget.foreground": color("foreground"),
            "editorHoverWidget.border": color("border"),
            "scrollbarSlider.background": color("scrollbar"),
            "scrollbarSlider.hoverBackground": color("scrollbar-hover"),
            "scrollbarSlider.activeBackground": color("scrollbar-active"),
            focusBorder: color("focus"),
        },
    };
}

export function registerEditorTheme(monaco: typeof MonacoApi): void {
    const root = document.documentElement;
    const mode = root.dataset.theme === "light" ? "light" : "dark";
    const computed = getComputedStyle(root);
    monaco.editor.defineTheme(editorThemeName(mode), createEditorTheme(
        mode, (role) => computed.getPropertyValue(role),
    ));
}

/** An owned wrapper: no selectors against Monaco's internal DOM. */
export function editorSurfaceStyle(): CSSProperties {
    return {
        background: "var(--bf-editor-background)",
        color: "var(--bf-editor-foreground)",
        border: "1px solid var(--bf-editor-border)",
        boxShadow: "none",
    };
}
