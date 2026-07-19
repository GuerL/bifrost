import { useEffect, useRef, useState } from "react";
import Editor, { type BeforeMount } from "@monaco-editor/react";
import type * as MonacoApi from "monaco-editor";
import type { RequestScripts } from "../types.ts";

export type ScriptRevealLocation = {
    key: number;
    scriptPhase: "pre-request" | "post-response";
    line?: number;
    column?: number;
};

type RequestScriptsEditorProps = {
    scripts: RequestScripts;
    selectedRequestId: string | null;
    beforeMountMonaco: BeforeMount;
    editorOptions: MonacoApi.editor.IStandaloneEditorConstructionOptions;
    editorTheme: "bifrost-midnight" | "bifrost-daylight";
    editorPanelStyle: (height: number | string, minHeight?: number) => React.CSSProperties;
    onChange: (next: RequestScripts) => void;
    onSubmitShortcut: () => void;
    revealLocation?: ScriptRevealLocation | null;
    fillHeight?: boolean;
    readOnly?: boolean;
};

export default function RequestScriptsEditor({
    scripts,
    selectedRequestId,
    beforeMountMonaco,
    editorOptions,
    editorTheme,
    editorPanelStyle,
    onChange,
    onSubmitShortcut,
    revealLocation,
    fillHeight = false,
    readOnly = false,
}: RequestScriptsEditorProps) {
    const [activePanel, setActivePanel] = useState<"pre" | "post">("pre");
    const showingPre = activePanel === "pre";
    const submitShortcutRef = useRef(onSubmitShortcut);
    const preEditorRef = useRef<MonacoApi.editor.IStandaloneCodeEditor | null>(null);
    const postEditorRef = useRef<MonacoApi.editor.IStandaloneCodeEditor | null>(null);
    const pendingRevealRef = useRef<ScriptRevealLocation | null>(null);
    const lastRevealKeyRef = useRef<number | null>(null);
    const decorationIdsRef = useRef<string[]>([]);

    useEffect(() => {
        submitShortcutRef.current = onSubmitShortcut;
    }, [onSubmitShortcut]);

    useEffect(() => {
        if (!revealLocation) return;
        if (lastRevealKeyRef.current === revealLocation.key) return;
        lastRevealKeyRef.current = revealLocation.key;

        pendingRevealRef.current = revealLocation;
        const targetPanel = revealLocation.scriptPhase === "pre-request" ? "pre" : "post";

        if (activePanel !== targetPanel) {
            setActivePanel(targetPanel);
            return;
        }

        const editor = targetPanel === "pre" ? preEditorRef.current : postEditorRef.current;
        if (!editor) return;

        applyScriptReveal(editor, revealLocation, decorationIdsRef);
        pendingRevealRef.current = null;
    }, [activePanel, revealLocation]);

    return (
        <div
            style={{
                display: "grid",
                gap: 12,
                marginTop: 12,
                minHeight: fillHeight ? 0 : undefined,
                height: fillHeight ? "100%" : undefined,
                gridTemplateRows: fillHeight ? "auto auto minmax(0, 1fr)" : undefined,
            }}
        >
            <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                Available APIs: <code>bf.runtime.get/set/unset/clear</code>, <code>bf.env.get/set/unset</code>,{" "}
                <code>bf.request</code>, <code>bf.response</code>, <code>bf.test(name, fn)</code>,{" "}
                <code>bf.expect(value)</code> (<code>pg</code> is still supported).
            </div>
            <div style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                <code>bf.environment</code>, <code>bf.collectionVariables</code>, and <code>bf.globals</code> are
                still supported for backward compatibility.
            </div>
            <div style={{ display: "flex", gap: 12, minHeight: 0, height: fillHeight ? "100%" : undefined }}>
                <div
                    style={{
                        marginTop: 25,
                        width: 220,
                        flexShrink: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    <button onClick={() => setActivePanel("pre")} style={menuButtonStyle(showingPre)}>
                        Pre-request Scripts
                    </button>
                    <button onClick={() => setActivePanel("post")} style={menuButtonStyle(!showingPre)}>
                        Post-response Scripts
                    </button>

                    <div style={{ fontSize: 12, color: "var(--pg-text-muted)", marginTop: 8 }}>
                        Example:
                        <pre
                            style={{
                                margin: "6px 0 0",
                                whiteSpace: "pre-wrap",
                                fontFamily: '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace',
                            }}
                        >
                            {`const response = bf.response?.json();
bf.runtime.set("accessToken", response?.token ?? "");
bf.env.set("lastAccessToken", response?.token ?? "");`}
                        </pre>
                    </div>
                </div>

                <div
                    style={{
                        display: "grid",
                        gap: 6,
                        flex: 1,
                        minWidth: 0,
                        minHeight: 0,
                        gridTemplateRows: fillHeight ? "auto minmax(0, 1fr)" : undefined,
                    }}
                >
                    <span style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 600 }}>
                        {showingPre ? "Pre-request script" : "Post-response script"}
                    </span>
                    <div style={editorPanelStyle(fillHeight ? "100%" : "min(26vh, 280px)", 160)}>
                        <Editor
                            key={`script-${showingPre ? "pre" : "post"}-${selectedRequestId ?? "none"}`}
                            height="100%"
                            language="javascript"
                            path={`/bifrost-script/${selectedRequestId ?? "none"}.${showingPre ? "pre" : "post"}.js`}
                            theme={editorTheme}
                            beforeMount={beforeMountMonaco}
                            onMount={(editor, monaco) => {
                                if (showingPre) {
                                    preEditorRef.current = editor;
                                } else {
                                    postEditorRef.current = editor;
                                }
                                editor.onDidDispose(() => {
                                    if (showingPre) {
                                        preEditorRef.current = null;
                                    } else {
                                        postEditorRef.current = null;
                                    }
                                });

                                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                                    submitShortcutRef.current();
                                });

                                const pendingReveal = pendingRevealRef.current;
                                if (!pendingReveal) return;
                                const pendingPanel =
                                    pendingReveal.scriptPhase === "pre-request" ? "pre" : "post";
                                const currentPanel = showingPre ? "pre" : "post";
                                if (pendingPanel !== currentPanel) return;
                                applyScriptReveal(editor, pendingReveal, decorationIdsRef);
                                pendingRevealRef.current = null;
                            }}
                            value={showingPre ? scripts.pre_request : scripts.post_response}
                            onChange={(value) =>
                                onChange({
                                    ...scripts,
                                    pre_request: showingPre ? value ?? "" : scripts.pre_request,
                                    post_response: showingPre ? scripts.post_response : value ?? "",
                                })
                            }
                            options={{ ...editorOptions, readOnly }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

function applyScriptReveal(
    editor: MonacoApi.editor.IStandaloneCodeEditor,
    revealLocation: ScriptRevealLocation,
    decorationIdsRef: React.MutableRefObject<string[]>
) {
    const model = editor.getModel();
    if (!model) {
        editor.focus();
        return;
    }

    const maxLine = model.getLineCount();
    const requestedLine = typeof revealLocation.line === "number" ? Math.floor(revealLocation.line) : 1;
    const line = Math.min(Math.max(requestedLine, 1), Math.max(maxLine, 1));
    const maxColumn = model.getLineMaxColumn(line);
    const requestedColumn = typeof revealLocation.column === "number" ? Math.floor(revealLocation.column) : 1;
    const column = Math.min(Math.max(requestedColumn, 1), Math.max(maxColumn, 1));

    editor.focus();
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column });
    editor.setSelection({
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: maxColumn,
    });

    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, [
        {
            range: {
                startLineNumber: line,
                startColumn: 1,
                endLineNumber: line,
                endColumn: maxColumn,
            },
            options: {
                isWholeLine: true,
                className: "bifrost-script-test-line-highlight",
            },
        },
    ]);
}

function menuButtonStyle(active: boolean): React.CSSProperties {
    return {
        height: 36,
        textAlign: "left",
        borderRadius: 10,
        border: active ? "1px solid var(--pg-primary)" : "1px solid var(--pg-border)",
        background: active ? "rgba(var(--pg-primary-rgb), 0.16)" : "var(--pg-surface-gradient)",
        color: active ? "var(--pg-text)" : "var(--pg-text-dim)",
        fontWeight: active ? 700 : 600,
        padding: "0 12px",
        cursor: "pointer",
    };
}
