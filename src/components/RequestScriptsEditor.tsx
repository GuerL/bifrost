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
    return (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                Available APIs: <code>pg.environment.get/set/unset</code>, <code>pg.request</code>,{" "}
                <code>pg.response</code>.
            </div>

            <div style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 600 }}>
                    Pre-request script
                </span>
                <div style={editorPanelStyle("24vh", 160)}>
                    <Editor
                        key={`script-pre-${selectedRequestId ?? "none"}`}
                        height="100%"
                        language="javascript"
                        path={`/postguerl-script/${selectedRequestId ?? "none"}.pre.js`}
                        theme="postguerl-midnight"
                        beforeMount={beforeMountMonaco}
                        value={scripts.pre_request}
                        onChange={(value) =>
                            onChange({
                                ...scripts,
                                pre_request: value ?? "",
                            })
                        }
                        options={editorOptions}
                    />
                </div>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 600 }}>
                    Post-response script
                </span>
                <div style={editorPanelStyle("30vh", 200)}>
                    <Editor
                        key={`script-post-${selectedRequestId ?? "none"}`}
                        height="100%"
                        language="javascript"
                        path={`/postguerl-script/${selectedRequestId ?? "none"}.post.js`}
                        theme="postguerl-midnight"
                        beforeMount={beforeMountMonaco}
                        value={scripts.post_response}
                        onChange={(value) =>
                            onChange({
                                ...scripts,
                                post_response: value ?? "",
                            })
                        }
                        options={editorOptions}
                    />
                </div>
            </div>

            <div style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
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
    );
}
