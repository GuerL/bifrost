import { useCallback, useEffect, useMemo, useRef } from "react";
import type { BeforeMount } from "@monaco-editor/react";
import type * as MonacoApi from "monaco-editor";

const TEMPLATE_VARIABLE_PATTERN = /{{\s*([^{}]+?)\s*}}/g;
const BODY_MODEL_PATH_SEGMENT = "/bifrost-body/";
const SCRIPT_MODEL_PATH_SEGMENT = "/bifrost-script/";

type TemplateVariableMatch = {
    name: string;
    startOffset: number;
    endOffset: number;
    raw: string;
};

type TemplateCompletionContext = {
    openIndex: number;
    replaceEnd: number;
    query: string;
};

type UseMonacoVariableSupportArgs = {
    variableSuggestions: string[];
    variableValues: Map<string, string>;
};

type UseMonacoVariableSupportResult = {
    beforeMountMonaco: BeforeMount;
    editorOptions: MonacoApi.editor.IStandaloneEditorConstructionOptions;
    bindBodyJsonEditor: (editor: MonacoApi.editor.IStandaloneCodeEditor) => void;
    bindBodyRawEditor: (editor: MonacoApi.editor.IStandaloneCodeEditor) => void;
};

function isBodyMonacoModel(model: MonacoApi.editor.ITextModel): boolean {
    return model.uri.path.includes(BODY_MODEL_PATH_SEGMENT);
}

function isScriptMonacoModel(model: MonacoApi.editor.ITextModel): boolean {
    return model.uri.path.includes(SCRIPT_MODEL_PATH_SEGMENT);
}

function collectTemplateVariableMatches(text: string): TemplateVariableMatch[] {
    const matches: TemplateVariableMatch[] = [];
    TEMPLATE_VARIABLE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = TEMPLATE_VARIABLE_PATTERN.exec(text)) !== null) {
        const raw = match[0];
        const name = (match[1] ?? "").trim();
        const startOffset = match.index;
        matches.push({
            name,
            raw,
            startOffset,
            endOffset: startOffset + raw.length,
        });
    }

    return matches;
}

function findTemplateVariableAtOffset(
    text: string,
    offset: number
): TemplateVariableMatch | null {
    return (
        collectTemplateVariableMatches(text).find(
            (entry) => offset >= entry.startOffset && offset <= entry.endOffset
        ) ?? null
    );
}

function getTemplateCompletionContext(
    text: string,
    caretOffset: number
): TemplateCompletionContext | null {
    if (caretOffset < 0 || caretOffset > text.length) return null;

    const openIndex = text.lastIndexOf("{{", caretOffset);
    if (openIndex === -1 || caretOffset < openIndex + 2) return null;

    const inside = text.slice(openIndex + 2, caretOffset);
    if (inside.includes("{") || inside.includes("}")) return null;

    const closeIndex = text.indexOf("}}", openIndex + 2);
    if (closeIndex !== -1 && caretOffset > closeIndex + 2) return null;

    return {
        openIndex,
        replaceEnd: closeIndex === -1 ? caretOffset : closeIndex + 2,
        query: inside.trim().toLowerCase(),
    };
}

function truncateForHover(value: string, maxLen = 180): string {
    const normalized = value.replace(/\n/g, "\\n");
    if (normalized.length <= maxLen) return normalized;
    return `${normalized.slice(0, maxLen)}…`;
}

export function useMonacoVariableSupport({
    variableSuggestions,
    variableValues,
}: UseMonacoVariableSupportArgs): UseMonacoVariableSupportResult {
    const monacoProvidersRef = useRef<MonacoApi.IDisposable[]>([]);
    const monacoFeaturesRegisteredRef = useRef(false);
    const variableSuggestionsRef = useRef<string[]>([]);
    const variableValuesRef = useRef<Map<string, string>>(new Map());
    const bodyJsonEditorRef = useRef<MonacoApi.editor.IStandaloneCodeEditor | null>(null);
    const bodyRawEditorRef = useRef<MonacoApi.editor.IStandaloneCodeEditor | null>(null);
    const bodyJsonDecorationsRef = useRef<string[]>([]);
    const bodyRawDecorationsRef = useRef<string[]>([]);
    const bodyJsonContentListenerRef = useRef<MonacoApi.IDisposable | null>(null);
    const bodyRawContentListenerRef = useRef<MonacoApi.IDisposable | null>(null);

    const getVariableValueForDisplay = useCallback((name: string): string | undefined => {
        const direct = variableValuesRef.current.get(name);
        if (direct !== undefined) return direct;

        if (!name.startsWith("$")) return undefined;
        return variableValuesRef.current.get(name.toLowerCase());
    }, []);

    const refreshEditorVariableDecorations = useCallback(
        (
            editor: MonacoApi.editor.IStandaloneCodeEditor | null,
            decorationsRef: { current: string[] }
        ) => {
            if (!editor) return;

            const model = editor.getModel();
            if (!model || !isBodyMonacoModel(model)) {
                decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
                return;
            }

            const text = model.getValue();
            const nextDecorations = collectTemplateVariableMatches(text).map((entry) => {
                const startPos = model.getPositionAt(entry.startOffset);
                const endPos = model.getPositionAt(entry.endOffset);
                const missing = getVariableValueForDisplay(entry.name) === undefined;

                return {
                    range: {
                        startLineNumber: startPos.lineNumber,
                        startColumn: startPos.column,
                        endLineNumber: endPos.lineNumber,
                        endColumn: endPos.column,
                    },
                    options: {
                        inlineClassName: missing
                            ? "pg-monaco-variable-missing"
                            : "pg-monaco-variable-ok",
                    },
                };
            });

            decorationsRef.current = editor.deltaDecorations(
                decorationsRef.current,
                nextDecorations
            );
        },
        [getVariableValueForDisplay]
    );

    const bindBodyJsonEditor = useCallback(
        (editor: MonacoApi.editor.IStandaloneCodeEditor) => {
            bodyJsonEditorRef.current = editor;
            bodyJsonContentListenerRef.current?.dispose();
            bodyJsonContentListenerRef.current = editor.onDidChangeModelContent(() => {
                refreshEditorVariableDecorations(editor, bodyJsonDecorationsRef);
            });
            refreshEditorVariableDecorations(editor, bodyJsonDecorationsRef);
        },
        [refreshEditorVariableDecorations]
    );

    const bindBodyRawEditor = useCallback(
        (editor: MonacoApi.editor.IStandaloneCodeEditor) => {
            bodyRawEditorRef.current = editor;
            bodyRawContentListenerRef.current?.dispose();
            bodyRawContentListenerRef.current = editor.onDidChangeModelContent(() => {
                refreshEditorVariableDecorations(editor, bodyRawDecorationsRef);
            });
            refreshEditorVariableDecorations(editor, bodyRawDecorationsRef);
        },
        [refreshEditorVariableDecorations]
    );

    const beforeMountMonaco = useCallback<BeforeMount>((monaco) => {
        monaco.editor.defineTheme("bifrost-midnight", {
            base: "vs-dark",
            inherit: true,
            rules: [
                { token: "keyword", foreground: "32bcc4" },
                { token: "number", foreground: "f59e0b" },
                { token: "string", foreground: "6adbe2" },
            ],
            colors: {
                "editor.background": "#0b1220",
                "editor.foreground": "#e2e8f0",
                "editorLineNumber.foreground": "#475569",
                "editorLineNumber.activeForeground": "#94a3b8",
                "editorCursor.foreground": "#009DA6",
                "editor.selectionBackground": "#009DA644",
                "editor.lineHighlightBackground": "#0f172a",
                "editorIndentGuide.background1": "#1e293b",
                "editorIndentGuide.activeBackground1": "#334155",
                "scrollbarSlider.background": "#009DA655",
                "scrollbarSlider.hoverBackground": "#009DA688",
                "scrollbarSlider.activeBackground": "#009DA6CC",
            },
        });

        // Keep JSON diagnostics enabled so syntax issues are surfaced immediately in editors.
        // Comments stay allowed, but trailing commas are flagged.
        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
            validate: true,
            allowComments: true,
            comments: "ignore",
            trailingCommas: "error",
        });

        if (monacoFeaturesRegisteredRef.current) return;
        monacoFeaturesRegisteredRef.current = true;

        const scriptApiDts = `
declare const pg: {
  environment: {
    get(name: string): string | undefined;
    set(name: string, value: unknown): void;
    unset(name: string): void;
    toObject(): Record<string, string>;
  };
  collectionVariables: {
    get(name: string): string | undefined;
    set(name: string, value: unknown): void;
    unset(name: string): void;
    toObject(): Record<string, string>;
  };
  globals: {
    get(name: string): string | undefined;
    set(name: string, value: unknown): void;
    unset(name: string): void;
    toObject(): Record<string, string>;
  };
  response: {
    status: { toBe(expected: unknown): void; toEqual(expected: unknown): void };
    statusCode: number | null;
    body: string;
    text(): string;
    json<T = unknown>(): T;
    headers: {
      get(name: string): string | undefined;
      has(name: string): boolean;
      entries(): Array<{ key: string; value: string }>;
      toObject(): Record<string, string>;
    };
  };
  test(name: string, callback: () => void): void;
  expect(actual: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
  };
};`;
        monaco.languages.typescript.javascriptDefaults.addExtraLib(
            scriptApiDts,
            "file:///bifrost/pg-scripting.d.ts"
        );
        monaco.languages.typescript.typescriptDefaults.addExtraLib(
            scriptApiDts,
            "file:///bifrost/pg-scripting.d.ts"
        );

        const languagesWithTemplateSupport = [
            "json",
            "plaintext",
            "xml",
            "html",
            "javascript",
            "typescript",
            "css",
            "sql",
        ];

        for (const languageId of languagesWithTemplateSupport) {
            const completionDisposable = monaco.languages.registerCompletionItemProvider(languageId, {
                triggerCharacters: ["{"],
                provideCompletionItems: (
                    model: MonacoApi.editor.ITextModel,
                    position: MonacoApi.Position
                ) => {
                    if (!isBodyMonacoModel(model) && !isScriptMonacoModel(model)) {
                        return { suggestions: [] };
                    }

                    const suggestions = variableSuggestionsRef.current;
                    if (!suggestions.length) return { suggestions: [] };

                    if (isScriptMonacoModel(model)) {
                        const jsSuggestions = [
                            "pg.response.json()",
                            "pg.response.text()",
                            "pg.response.headers.get(\"Authorization\")",
                            "pg.environment.get(\"key\")",
                            "pg.environment.set(\"key\", \"value\")",
                            "pg.collectionVariables.set(\"foo\", \"bar\")",
                            "pg.test(\"name\", () => {})",
                        ];
                        return {
                            suggestions: jsSuggestions.map((value, index) => ({
                                label: value,
                                insertText: value,
                                kind: monaco.languages.CompletionItemKind.Function,
                                sortText: `0_${String(index).padStart(3, "0")}`,
                            })),
                        };
                    }

                    const text = model.getValue();
                    const offset = model.getOffsetAt(position);
                    const context = getTemplateCompletionContext(text, offset);
                    if (!context) return { suggestions: [] };

                    const filtered = context.query
                        ? suggestions.filter((name) =>
                            name.toLowerCase().includes(context.query)
                        )
                        : suggestions;

                    if (filtered.length === 0) return { suggestions: [] };

                    const startPos = model.getPositionAt(context.openIndex);
                    const endPos = model.getPositionAt(context.replaceEnd);
                    const replaceRange = new monaco.Range(
                        startPos.lineNumber,
                        startPos.column,
                        endPos.lineNumber,
                        endPos.column
                    );

                    return {
                        suggestions: filtered.slice(0, 100).map((name) => {
                            const resolved = getVariableValueForDisplay(name);
                            const detail = resolved === undefined
                                ? "Missing in active environment"
                                : `Current: ${truncateForHover(resolved, 90)}`;

                            return {
                                label: `{{${name}}}`,
                                insertText: `{{${name}}}`,
                                kind: monaco.languages.CompletionItemKind.Variable,
                                detail,
                                sortText: `0_${name.toLowerCase()}`,
                                range: replaceRange,
                            };
                        }),
                    };
                },
            });

            const hoverDisposable = monaco.languages.registerHoverProvider(languageId, {
                provideHover: (
                    model: MonacoApi.editor.ITextModel,
                    position: MonacoApi.Position
                ) => {
                    if (!isBodyMonacoModel(model)) return null;

                    const text = model.getValue();
                    const offset = model.getOffsetAt(position);
                    const match = findTemplateVariableAtOffset(text, offset);
                    if (!match) return null;

                    const startPos = model.getPositionAt(match.startOffset);
                    const endPos = model.getPositionAt(match.endOffset);
                    const value = getVariableValueForDisplay(match.name);
                    const description = value === undefined
                        ? "Variable missing in the active environment."
                        : `Current value: \`${truncateForHover(value)}\``;

                    return {
                        range: new monaco.Range(
                            startPos.lineNumber,
                            startPos.column,
                            endPos.lineNumber,
                            endPos.column
                        ),
                        contents: [
                            { value: `**${match.raw}**` },
                            { value: description },
                        ],
                    };
                },
            });

            monacoProvidersRef.current.push(completionDisposable, hoverDisposable);
        }
    }, [getVariableValueForDisplay]);

    const editorOptions = useMemo(
        () => ({
            minimap: { enabled: false },
            fontSize: 13,
            lineHeight: 22,
            fontLigatures: true,
            smoothScrolling: true,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            insertSpaces: true,
            padding: { top: 12, bottom: 12 },
            renderLineHighlight: "all" as const,
            roundedSelection: true,
            wordWrap: "on" as const,
            scrollbar: {
                vertical: "auto" as const,
                horizontal: "auto" as const,
                alwaysConsumeMouseWheel: true,
                useShadows: false,
            },
            quickSuggestions: { other: true, comments: true, strings: true },
            suggestOnTriggerCharacters: true,
            wordBasedSuggestions: "off" as const,
            mouseWheelScrollSensitivity: 1,
            fastScrollSensitivity: 3,
        }),
        []
    );

    useEffect(() => {
        variableSuggestionsRef.current = variableSuggestions;
        variableValuesRef.current = variableValues;

        refreshEditorVariableDecorations(bodyJsonEditorRef.current, bodyJsonDecorationsRef);
        refreshEditorVariableDecorations(bodyRawEditorRef.current, bodyRawDecorationsRef);
    }, [variableSuggestions, variableValues, refreshEditorVariableDecorations]);

    useEffect(() => {
        return () => {
            for (const disposable of monacoProvidersRef.current) {
                disposable.dispose();
            }
            monacoProvidersRef.current = [];
            bodyJsonContentListenerRef.current?.dispose();
            bodyRawContentListenerRef.current?.dispose();
        };
    }, []);

    return {
        beforeMountMonaco,
        editorOptions,
        bindBodyJsonEditor,
        bindBodyRawEditor,
    };
}
