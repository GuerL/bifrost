import Editor, { type BeforeMount } from "@monaco-editor/react";
import type * as MonacoApi from "monaco-editor";
import KeyValueTable from "../KeyValueTable.tsx";
import VariableInput, { type VariableStatus } from "../VariableInput.tsx";
import type { Body, Request } from "../types.ts";

type RequestBodyEditorProps = {
    draft: Request;
    selectedRequestId: string | null;
    beforeMountMonaco: BeforeMount;
    editorOptions: MonacoApi.editor.IStandaloneEditorConstructionOptions;
    onPatchDraft: (patch: Partial<Request>) => void;
    onSetFullDraft: (next: Request) => void;
    onMountBodyJsonEditor: (editor: MonacoApi.editor.IStandaloneCodeEditor) => void;
    onMountBodyRawEditor: (editor: MonacoApi.editor.IStandaloneCodeEditor) => void;
    resolveVariableStatus: (name: string) => VariableStatus;
    resolveVariableValue: (name: string) => string | undefined;
    variableSuggestions: string[];
    editorPanelStyle: (height: number | string, minHeight?: number) => React.CSSProperties;
    onSubmitShortcut: () => void;
};

function languageFromContentType(contentType: string): string {
    const lower = contentType.toLowerCase();
    if (lower.includes("json")) return "json";
    if (lower.includes("xml")) return "xml";
    if (lower.includes("html")) return "html";
    if (lower.includes("javascript")) return "javascript";
    if (lower.includes("typescript")) return "typescript";
    if (lower.includes("css")) return "css";
    if (lower.includes("sql")) return "sql";
    return "plaintext";
}

function stripJsonComments(input: string): string {
    let out = "";
    let inString = false;
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        const next = input[i + 1] ?? "";

        if (inLineComment) {
            if (ch === "\n") {
                inLineComment = false;
                out += ch;
            }
            continue;
        }

        if (inBlockComment) {
            if (ch === "*" && next === "/") {
                inBlockComment = false;
                i += 1;
                continue;
            }
            if (ch === "\n") {
                out += ch;
            }
            continue;
        }

        if (inString) {
            out += ch;
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === "\"") {
                inString = false;
            }
            continue;
        }

        if (ch === "\"") {
            inString = true;
            out += ch;
            continue;
        }

        if (ch === "/" && next === "/") {
            inLineComment = true;
            i += 1;
            continue;
        }

        if (ch === "/" && next === "*") {
            inBlockComment = true;
            i += 1;
            continue;
        }

        out += ch;
    }

    return out;
}

function parseJsonc(text: string): unknown {
    const stripped = stripJsonComments(text).trim();
    return JSON.parse(stripped.length > 0 ? stripped : "{}");
}

export default function RequestBodyEditor({
    draft,
    selectedRequestId,
    beforeMountMonaco,
    editorOptions,
    onPatchDraft,
    onSetFullDraft,
    onMountBodyJsonEditor,
    onMountBodyRawEditor,
    resolveVariableStatus,
    resolveVariableValue,
    variableSuggestions,
    editorPanelStyle,
    onSubmitShortcut,
}: RequestBodyEditorProps) {
    return (
        <>
            <select
                value={draft.body.type}
                onChange={(e) => {
                    const t = e.target.value as Body["type"];
                    const body: Body =
                        t === "none"
                            ? { type: "none" }
                            : t === "json"
                                ? { type: "json", value: {}, text: "{\n\n}" }
                                : t === "raw"
                                    ? { type: "raw", content_type: "text/plain", text: "" }
                                    : { type: "form", fields: [] };

                    onPatchDraft({ body });
                }}
            >
                <option value="none">none</option>
                <option value="json">json</option>
                <option value="raw">raw</option>
                <option value="form">form</option>
            </select>

            {draft.body.type === "json" && (() => {
                const jsonBody = draft.body;
                return (
                    <div style={editorPanelStyle("34vh", 280)}>
                        <Editor
                            key={`body-json-${selectedRequestId ?? "none"}`}
                            height="100%"
                            language="json"
                            path={`/bifrost-body/${selectedRequestId ?? "none"}.json`}
                            theme="bifrost-midnight"
                            beforeMount={beforeMountMonaco}
                            onMount={(editor, monaco) => {
                                onMountBodyJsonEditor(editor);
                                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                                    onSubmitShortcut();
                                });
                            }}
                            defaultValue={
                                jsonBody.text && jsonBody.text.trim().length > 0
                                    ? jsonBody.text
                                    : JSON.stringify(jsonBody.value ?? {}, null, 2)
                            }
                            onChange={(value) => {
                                const nextText = value ?? "";
                                try {
                                    const parsed = parseJsonc(nextText);
                                    onSetFullDraft({
                                        ...draft,
                                        body: { type: "json", value: parsed, text: nextText },
                                    });
                                } catch {
                                    onSetFullDraft({
                                        ...draft,
                                        body: {
                                            type: "json",
                                            value: jsonBody.value ?? {},
                                            text: nextText,
                                        },
                                    });
                                }
                            }}
                            options={editorOptions}
                        />
                    </div>
                );
            })()}

            {draft.body.type === "raw" && (() => {
                const rawBody = draft.body;
                return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <VariableInput
                            placeholder="Content-Type"
                            value={rawBody.content_type}
                            onChange={(nextContentType) =>
                                onSetFullDraft({
                                    ...draft,
                                    body: {
                                        type: "raw",
                                        content_type: nextContentType,
                                        text: rawBody.text,
                                    },
                                })
                            }
                            resolveVariableStatus={resolveVariableStatus}
                            resolveVariableValue={resolveVariableValue}
                            variableSuggestions={variableSuggestions}
                        />
                        <div style={editorPanelStyle("34vh", 280)}>
                            <Editor
                                key={`body-raw-${selectedRequestId ?? "none"}`}
                                height="100%"
                                language={languageFromContentType(rawBody.content_type)}
                                path={`/bifrost-body/${selectedRequestId ?? "none"}.raw`}
                                theme="bifrost-midnight"
                                beforeMount={beforeMountMonaco}
                                onMount={(editor, monaco) => {
                                    onMountBodyRawEditor(editor);
                                    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                                        onSubmitShortcut();
                                    });
                                }}
                                defaultValue={rawBody.text}
                                onChange={(value) =>
                                    onSetFullDraft({
                                        ...draft,
                                        body: {
                                            type: "raw",
                                            content_type: rawBody.content_type,
                                            text: value ?? "",
                                        },
                                    })
                                }
                                options={editorOptions}
                            />
                        </div>
                    </div>
                );
            })()}

            {draft.body.type === "form" && (
                <KeyValueTable
                    rows={draft.body.fields}
                    onChange={(next) =>
                        onSetFullDraft({
                            ...draft,
                            body: { type: "form", fields: next },
                        })
                    }
                    resolveVariableStatus={resolveVariableStatus}
                    resolveVariableValue={resolveVariableValue}
                    variableSuggestions={variableSuggestions}
                />
            )}
        </>
    );
}
