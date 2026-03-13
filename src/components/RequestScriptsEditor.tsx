import { useState } from "react";
import Editor, { type BeforeMount } from "@monaco-editor/react";
import type * as MonacoApi from "monaco-editor";
import type { RequestScripts } from "../types.ts";

type RequestScriptsEditorProps = {
    scripts: RequestScripts;
    selectedRequestId: string | null;
    beforeMountMonaco: BeforeMount;
    editorOptions: MonacoApi.editor.IStandaloneEditorConstructionOptions;
    editorPanelStyle: (height: number | string, minHeight?: number) => React.CSSProperties;
    onChange: (next: RequestScripts) => void;
};

export default function RequestScriptsEditor({
    scripts,
    selectedRequestId,
    beforeMountMonaco,
    editorOptions,
    editorPanelStyle,
    onChange,
}: RequestScriptsEditorProps) {
    const [activePanel, setActivePanel] = useState<"pre" | "post">("pre");
    const showingPre = activePanel === "pre";

    return (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                Available APIs: <code>pg.environment.get/set/unset</code>, <code>pg.request</code>,{" "}
                <code>pg.response</code>.
            </div>
            <div style={{ display: "flex", gap: 12, minHeight: 0 }}>
                <div
                    style={{
                        marginTop:25,
                        width: 220,
                        flexShrink: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    <button
                        onClick={() => setActivePanel("pre")}
                        style={menuButtonStyle(showingPre)}
                    >
                        Pre-request Scripts
                    </button>
                    <button
                        onClick={() => setActivePanel("post")}
                        style={menuButtonStyle(!showingPre)}
                    >
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
                            {`const response = pg.response?.json();
pg.environment.set("accessToken", response?.token ?? "");`}
                        </pre>
                    </div>
                </div>

                <div style={{ display: "grid", gap: 6, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 600 }}>
                        {showingPre ? "Pre-request script" : "Post-response script"}
                    </span>
                    <div style={editorPanelStyle("24vh" ,  160 )}>
                        <Editor
                            key={`script-${showingPre ? "pre" : "post"}-${selectedRequestId ?? "none"}`}
                            height="100%"
                            language="javascript"
                            path={`/postguerl-script/${selectedRequestId ?? "none"}.${showingPre ? "pre" : "post"}.js`}
                            theme="postguerl-midnight"
                            beforeMount={beforeMountMonaco}
                            value={showingPre ? scripts.pre_request : scripts.post_response}
                            onChange={(value) =>
                                onChange({
                                    ...scripts,
                                    pre_request: showingPre ? (value ?? "") : scripts.pre_request,
                                    post_response: showingPre ? scripts.post_response : (value ?? ""),
                                })
                            }
                            options={editorOptions}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
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
