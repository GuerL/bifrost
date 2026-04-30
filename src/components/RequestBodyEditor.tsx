import { useEffect, useRef } from "react";
import Editor, { type BeforeMount } from "@monaco-editor/react";
import type * as MonacoApi from "monaco-editor";
import KeyValueTable from "../KeyValueTable.tsx";
import VariableInput, { type VariableStatus } from "../VariableInput.tsx";
import AppSelect from "./AppSelect.tsx";
import type { Body, KeyValue, MultipartField, Request } from "../types.ts";
import MultipartBodyEditor from "./MultipartBodyEditor.tsx";

type RequestBodyEditorProps = {
    draft: Request;
    selectedRequestId: string | null;
    beforeMountMonaco: BeforeMount;
    editorOptions: MonacoApi.editor.IStandaloneEditorConstructionOptions;
    editorTheme: "bifrost-midnight" | "bifrost-daylight";
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

const BODY_TYPE_OPTIONS = [
    { value: "none", label: "None" },
    { value: "json", label: "JSON" },
    { value: "raw", label: "Raw" },
    { value: "form", label: "Form URL Encoded" },
    { value: "multipart", label: "Multipart Form" },
];

function jsonTextFromBody(body: Extract<Body, { type: "json" }>): string {
    if (typeof body.text === "string" && body.text.trim().length > 0) {
        return body.text;
    }
    try {
        return JSON.stringify(body.value ?? {}, null, 2);
    } catch {
        return "{}";
    }
}

function cloneKeyValues(fields: KeyValue[]): KeyValue[] {
    return fields.map((field) => ({ ...field }));
}

function cloneMultipartFields(fields: MultipartField[]): MultipartField[] {
    return fields.map((field) => ({ ...field }));
}

export default function RequestBodyEditor({
    draft,
    selectedRequestId,
    beforeMountMonaco,
    editorOptions,
    editorTheme,
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
    const submitShortcutRef = useRef(onSubmitShortcut);
    const textDraftByRequestIdRef = useRef<Record<string, string>>({});
    const formDraftByRequestIdRef = useRef<Record<string, KeyValue[]>>({});
    const multipartDraftByRequestIdRef = useRef<Record<string, MultipartField[]>>({});

    useEffect(() => {
        submitShortcutRef.current = onSubmitShortcut;
    }, [onSubmitShortcut]);

    useEffect(() => {
        if (!selectedRequestId) return;

        if (draft.body.type === "raw") {
            textDraftByRequestIdRef.current[selectedRequestId] = draft.body.text;
            return;
        }

        if (draft.body.type === "json") {
            textDraftByRequestIdRef.current[selectedRequestId] = jsonTextFromBody(draft.body);
            return;
        }

        if (draft.body.type === "form") {
            formDraftByRequestIdRef.current[selectedRequestId] = cloneKeyValues(draft.body.fields);
            return;
        }

        if (draft.body.type === "multipart") {
            multipartDraftByRequestIdRef.current[selectedRequestId] = cloneMultipartFields(draft.body.fields);
        }
    }, [draft.body, selectedRequestId]);

    function applyBodyTypeSwitch(nextType: Body["type"]) {
        const currentBody = draft.body;
        if (nextType === currentBody.type) {
            return;
        }

        const requestId = selectedRequestId ?? "__global__";
        const rememberedText = textDraftByRequestIdRef.current[requestId] ?? "";
        const rememberedForm = formDraftByRequestIdRef.current[requestId] ?? [];
        const rememberedMultipart = multipartDraftByRequestIdRef.current[requestId] ?? [];

        let nextBody: Body;
        if (nextType === "none") {
            nextBody = { type: "none" };
        } else if (nextType === "raw") {
            const nextText =
                currentBody.type === "raw"
                    ? currentBody.text
                    : currentBody.type === "json"
                        ? jsonTextFromBody(currentBody)
                        : rememberedText;
            nextBody = {
                type: "raw",
                content_type:
                    currentBody.type === "raw"
                        ? currentBody.content_type
                        : "text/plain",
                text: nextText,
            };
        } else if (nextType === "json") {
            const nextText =
                currentBody.type === "raw"
                    ? currentBody.text
                    : currentBody.type === "json"
                        ? jsonTextFromBody(currentBody)
                        : rememberedText;
            let parsedJson: unknown = currentBody.type === "json" ? currentBody.value : {};
            if (nextText.trim().length > 0) {
                try {
                    parsedJson = parseJsonc(nextText);
                } catch {
                    // Keep mode switch non-destructive even if content is temporarily invalid JSON.
                }
            }
            nextBody = {
                type: "json",
                value: parsedJson,
                text: nextText,
            };
        } else if (nextType === "form") {
            nextBody = {
                type: "form",
                fields:
                    currentBody.type === "form"
                        ? cloneKeyValues(currentBody.fields)
                        : cloneKeyValues(rememberedForm),
            };
        } else {
            nextBody = {
                type: "multipart",
                fields:
                    currentBody.type === "multipart"
                        ? cloneMultipartFields(currentBody.fields)
                        : cloneMultipartFields(rememberedMultipart),
            };
        }

        onPatchDraft({ body: nextBody });
    }

    return (
        <>
            <AppSelect
                value={draft.body.type}
                options={BODY_TYPE_OPTIONS}
                ariaLabel="Request body type"
                onValueChange={(nextValue) => {
                    applyBodyTypeSwitch(nextValue as Body["type"]);
                }}
            />
            <div
                style={{
                    marginTop: 6,
                    fontSize: 12,
                    color: "var(--pg-text-muted)",
                }}
            >
                Only the selected body type is sent.
            </div>

            {draft.body.type === "json" && (() => {
                const jsonBody = draft.body;
                return (
                    <div style={editorPanelStyle("34vh", 280)}>
                        <Editor
                            key={`body-json-${selectedRequestId ?? "none"}`}
                            height="100%"
                            language="json"
                            path={`/bifrost-body/${selectedRequestId ?? "none"}.json`}
                            theme={editorTheme}
                            beforeMount={beforeMountMonaco}
                            onMount={(editor, monaco) => {
                                onMountBodyJsonEditor(editor);
                                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                                    submitShortcutRef.current();
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
                                theme={editorTheme}
                                beforeMount={beforeMountMonaco}
                                onMount={(editor, monaco) => {
                                    onMountBodyRawEditor(editor);
                                    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                                        submitShortcutRef.current();
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

            {draft.body.type === "multipart" && (
                <MultipartBodyEditor
                    fields={draft.body.fields}
                    onChange={(nextFields) =>
                        onSetFullDraft({
                            ...draft,
                            body: { type: "multipart", fields: nextFields },
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
