import { useEffect, useMemo, useRef, useState } from "react";
import type { HttpResponseDto } from "../types.ts";

export type ResponseTabId = "body" | "cookies" | "headers" | "runtime";

type CopyState = "idle" | "copied" | "error";
type BodyMode = "raw" | "preview";

type CookieItem = {
    name: string;
    value: string;
    attributes: string;
};

type ResponseBodyView = {
    displayText: string;
    copyText: string;
    isJson: boolean;
    canPreview: boolean;
    previewHtml: string | null;
};

type JsonTokenType = "plain" | "key" | "string" | "number" | "boolean" | "null";

type JsonToken = {
    text: string;
    type: JsonTokenType;
};

type ResponsePanelProps = {
    response: HttpResponseDto | null;
    statusText: string;
    scriptReport: {
        preRequestError: string | null;
        postResponseError: string | null;
        tests: { name: string; status: "passed" | "failed"; error: string | null }[];
    } | null;
    runtimeVariables: Record<string, string>;
    onClearRuntimeVariables: () => void;
    activeTab: ResponseTabId;
    onTabChange: (tab: ResponseTabId) => void;
};

export default function ResponsePanel({
    response,
    statusText,
    scriptReport,
    runtimeVariables,
    onClearRuntimeVariables,
    activeTab,
    onTabChange,
}: ResponsePanelProps) {
    const bodyView = useMemo(() => formatResponseBody(response), [response]);
    const jsonTokens = useMemo(
        () => (bodyView.isJson ? tokenizeJson(bodyView.displayText) : []),
        [bodyView.displayText, bodyView.isJson]
    );
    const cookies = useMemo(() => extractCookies(response), [response]);
    const hasScriptInfo = !!scriptReport && (
        !!scriptReport.preRequestError ||
        !!scriptReport.postResponseError ||
        scriptReport.tests.length > 0
    );
    const [copyState, setCopyState] = useState<CopyState>("idle");
    const [bodyMode, setBodyMode] = useState<BodyMode>("raw");
    const [bodyControlsHovered, setBodyControlsHovered] = useState(false);
    const copyResetTimerRef = useRef<number | null>(null);

    useEffect(() => {
        setCopyState("idle");
    }, [bodyView.copyText]);

    useEffect(() => {
        if (!bodyView.canPreview && bodyMode === "preview") {
            setBodyMode("raw");
        }
    }, [bodyMode, bodyView.canPreview]);

    useEffect(() => {
        return () => {
            if (copyResetTimerRef.current !== null) {
                window.clearTimeout(copyResetTimerRef.current);
            }
        };
    }, []);

    const handleCopyBody = async () => {
        if (!bodyView.copyText) return;
        const copied = await copyTextToClipboard(bodyView.copyText);
        setCopyState(copied ? "copied" : "error");
        if (copyResetTimerRef.current !== null) {
            window.clearTimeout(copyResetTimerRef.current);
        }
        copyResetTimerRef.current = window.setTimeout(() => {
            setCopyState("idle");
            copyResetTimerRef.current = null;
        }, 1600);
    };

    return (
        <div
            style={{
                display: "flex",
                gap: 8,
                flexDirection: "column",
                width: "100%",
                minHeight: 0,
                flex: 1,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexShrink: 0,
                }}
            >
                <h3 style={{ margin: 0 }}>Response</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--pg-text-dim)" }}>
                    <span style={{ fontWeight: 600 }}>Status</span>
                    <span>{statusText}</span>
                </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0, alignItems: "center" }}>
                <button onClick={() => onTabChange("body")} style={responseTabStyle(activeTab === "body")}>
                    Body
                </button>
                <button onClick={() => onTabChange("cookies")} style={responseTabStyle(activeTab === "cookies")}>
                    Cookies
                </button>
                <button onClick={() => onTabChange("headers")} style={responseTabStyle(activeTab === "headers")}>
                    Headers
                </button>
                <button onClick={() => onTabChange("runtime")} style={responseTabStyle(activeTab === "runtime")}>
                    Runtime
                </button>
                {activeTab === "body" && (
                    <button
                        onClick={() => void handleCopyBody()}
                        disabled={!bodyView.copyText}
                        style={copyBodyButtonStyle(!bodyView.copyText, copyState)}
                        title={copyButtonTitle(copyState)}
                        aria-label={copyButtonTitle(copyState)}
                    >
                        <CopyStatusIcon state={copyState} />
                    </button>
                )}
            </div>

            {hasScriptInfo && scriptReport && (
                <div style={scriptPanelStyle()}>
                    <div style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 700 }}>
                        Script report
                    </div>

                    {scriptReport.preRequestError && (
                        <div style={scriptErrorStyle()}>
                            Pre-request error: {scriptReport.preRequestError}
                        </div>
                    )}

                    {scriptReport.postResponseError && (
                        <div style={scriptErrorStyle()}>
                            Post-response error: {scriptReport.postResponseError}
                        </div>
                    )}

                    {scriptReport.tests.length > 0 && (
                        <div style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 700 }}>
                                Tests
                            </div>
                            {scriptReport.tests.map((test, index) => (
                                <div
                                    key={`${test.name}-${index}`}
                                    style={{
                                        fontSize: 12,
                                        color: test.status === "passed" ? "var(--pg-primary-soft)" : "var(--pg-danger)",
                                    }}
                                >
                                    {test.status === "passed" ? "✓" : "✗"} {test.name}
                                    {test.error ? ` — ${test.error}` : ""}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {activeTab === "body" && (
                <div
                    style={responseBodyContainerStyle()}
                    onMouseEnter={() => setBodyControlsHovered(true)}
                    onMouseLeave={() => setBodyControlsHovered(false)}
                >
                    {bodyView.canPreview && (
                        <div style={bodyModeControlsStyle(bodyControlsHovered)}>
                            <button
                                onClick={() => setBodyMode("raw")}
                                style={bodyModeButtonStyle(bodyMode === "raw")}
                            >
                                Raw
                            </button>
                            <button
                                onClick={() => setBodyMode("preview")}
                                style={bodyModeButtonStyle(bodyMode === "preview")}
                            >
                                Preview
                            </button>
                        </div>
                    )}
                    {bodyMode === "preview" && bodyView.canPreview ? (
                        <div style={responsePreviewWrapStyle()}>
                            <iframe
                                title="Response preview"
                                srcDoc={bodyView.previewHtml ?? ""}
                                sandbox=""
                                style={responsePreviewFrameStyle()}
                            />
                        </div>
                    ) : (
                        <pre
                            style={responsePreStyle(bodyView.isJson, bodyView.canPreview)}
                        >
                            {bodyView.isJson
                                ? jsonTokens.map((token, index) => (
                                    <span key={`${token.type}-${index}`} style={jsonTokenStyle(token.type)}>
                                        {token.text}
                                    </span>
                                ))
                                : bodyView.displayText}
                        </pre>
                    )}
                </div>
            )}

            {activeTab === "headers" && (
                <div style={responsePanelStyle()}>
                    {!response || response.headers.length === 0 ? (
                        <div style={emptyStateStyle()}>No headers in this response.</div>
                    ) : (
                        <table style={tableStyle()}>
                            <thead>
                            <tr>
                                <th style={thStyle()}>Header</th>
                                <th style={thStyle()}>Value</th>
                            </tr>
                            </thead>
                            <tbody>
                            {response.headers.map((header, index) => (
                                <tr key={`${header.key}-${index}`}>
                                    <td style={tdStyle()}>{header.key}</td>
                                    <td style={tdStyle()}>{header.value}</td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {activeTab === "cookies" && (
                <div style={responsePanelStyle()}>
                    {cookies.length === 0 ? (
                        <div style={emptyStateStyle()}>No Set-Cookie header found.</div>
                    ) : (
                        <table style={tableStyle()}>
                            <thead>
                            <tr>
                                <th style={thStyle()}>Name</th>
                                <th style={thStyle()}>Value</th>
                                <th style={thStyle()}>Attributes</th>
                            </tr>
                            </thead>
                            <tbody>
                            {cookies.map((cookie, index) => (
                                <tr key={`${cookie.name}-${index}`}>
                                    <td style={tdStyle()}>{cookie.name}</td>
                                    <td style={tdStyle()}>{cookie.value}</td>
                                    <td style={tdStyle()}>{cookie.attributes}</td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {activeTab === "runtime" && (
                <div style={responsePanelStyle()}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 700 }}>
                            Runtime variables ({Object.keys(runtimeVariables).length})
                        </div>
                        <button
                            onClick={onClearRuntimeVariables}
                            disabled={Object.keys(runtimeVariables).length === 0}
                            style={responseTabStyle(false)}
                        >
                            Clear
                        </button>
                    </div>

                    {Object.keys(runtimeVariables).length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--pg-text-muted)", marginTop: 8 }}>
                            No runtime variable yet.
                        </div>
                    ) : (
                        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                            {Object.entries(runtimeVariables)
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([key, value]) => (
                                    <div
                                        key={key}
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "minmax(0, 220px) minmax(0, 1fr)",
                                            gap: 8,
                                            fontSize: 12,
                                            alignItems: "center",
                                        }}
                                    >
                                        <div style={{ color: "var(--pg-text-muted)", fontFamily: "monospace" }}>
                                            {key}
                                        </div>
                                        <div
                                            style={{
                                                color: "var(--pg-text-dim)",
                                                fontFamily: "monospace",
                                                wordBreak: "break-word",
                                            }}
                                        >
                                            {value}
                                        </div>
                                    </div>
                                ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function formatResponseBody(response: HttpResponseDto | null): ResponseBodyView {
    if (!response) {
        return { displayText: "No response yet.", copyText: "", isJson: false, canPreview: false, previewHtml: null };
    }
    if (!response.body_text) {
        return { displayText: "(empty body)", copyText: "", isJson: false, canPreview: false, previewHtml: null };
    }

    const contentType = findHeaderValue(response, "content-type")?.toLowerCase() ?? "";
    const raw = response.body_text;
    const looksLikeHtml = isHtmlContent(contentType, raw);
    const looksLikeJson =
        contentType.includes("application/json") ||
        contentType.includes("+json") ||
        raw.trim().startsWith("{") ||
        raw.trim().startsWith("[");

    if (looksLikeHtml) {
        return {
            displayText: raw,
            copyText: raw,
            isJson: false,
            canPreview: true,
            previewHtml: raw,
        };
    }

    if (!looksLikeJson) {
        return { displayText: raw, copyText: raw, isJson: false, canPreview: false, previewHtml: null };
    }

    try {
        const pretty = JSON.stringify(JSON.parse(raw), null, 2);
        return { displayText: pretty, copyText: pretty, isJson: true, canPreview: false, previewHtml: null };
    } catch {
        return { displayText: raw, copyText: raw, isJson: false, canPreview: false, previewHtml: null };
    }
}

function isHtmlContent(contentType: string, body: string): boolean {
    if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
        return true;
    }

    const trimmed = body.trimStart().toLowerCase();
    return (
        trimmed.startsWith("<!doctype html") ||
        trimmed.startsWith("<html") ||
        trimmed.startsWith("<head") ||
        trimmed.startsWith("<body")
    );
}

function tokenizeJson(json: string): JsonToken[] {
    const tokenRegex = /("(?:\\u[a-fA-F\d]{4}|\\[^u]|[^\\"])*")(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    const tokens: JsonToken[] = [];
    let lastIndex = 0;

    for (const match of json.matchAll(tokenRegex)) {
        const full = match[0];
        const index = match.index ?? 0;
        if (index > lastIndex) {
            tokens.push({ text: json.slice(lastIndex, index), type: "plain" });
        }

        const hasQuotedString = typeof match[1] === "string";
        const hasKeySeparator = typeof match[2] === "string";

        let type: JsonTokenType;
        if (hasQuotedString) {
            type = hasKeySeparator ? "key" : "string";
        } else if (full === "true" || full === "false") {
            type = "boolean";
        } else if (full === "null") {
            type = "null";
        } else {
            type = "number";
        }

        tokens.push({ text: full, type });
        lastIndex = index + full.length;
    }

    if (lastIndex < json.length) {
        tokens.push({ text: json.slice(lastIndex), type: "plain" });
    }

    return tokens;
}

function findHeaderValue(response: HttpResponseDto, key: string): string | undefined {
    const target = key.toLowerCase();
    const match = response.headers.find((header) => header.key.toLowerCase() === target);
    return match?.value;
}

function extractCookies(response: HttpResponseDto | null): CookieItem[] {
    if (!response) return [];
    const setCookieHeaders = response.headers
        .filter((header) => header.key.toLowerCase() === "set-cookie")
        .map((header) => header.value)
        .filter((value) => value.trim().length > 0);

    return setCookieHeaders
        .map(parseSetCookieHeader)
        .filter((cookie): cookie is CookieItem => cookie !== null);
}

function parseSetCookieHeader(value: string): CookieItem | null {
    const parts = value.split(";").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    const first = parts[0];
    const equalIndex = first.indexOf("=");
    if (equalIndex === -1) {
        return {
            name: first,
            value: "",
            attributes: parts.slice(1).join("; "),
        };
    }

    return {
        name: first.slice(0, equalIndex).trim(),
        value: first.slice(equalIndex + 1).trim(),
        attributes: parts.slice(1).join("; "),
    };
}

function responseTabStyle(active: boolean): React.CSSProperties {
    return {
        height: 28,
        padding: "0 10px",
        borderRadius: 9,
        border: active ? "1px solid var(--pg-primary)" : "1px solid var(--pg-border)",
        background: active ? "var(--pg-primary)" : "var(--pg-surface-gradient)",
        color: active ? "var(--pg-primary-ink)" : "var(--pg-text)",
        cursor: "pointer",
        fontWeight: 600,
        fontSize: 12,
        boxShadow: "none",
    };
}

function responseBodyContainerStyle(): React.CSSProperties {
    return {
        width: "100%",
        minWidth: 0,
        minHeight: 0,
        flex: 1,
        display: "flex",
        position: "relative",
    };
}

function bodyModeControlsStyle(visible: boolean): React.CSSProperties {
    return {
        position: "absolute",
        top: 10,
        right: 10,
        zIndex: 4,
        display: "flex",
        gap: 6,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(-4px)",
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 120ms ease, transform 120ms ease",
    };
}

function bodyModeButtonStyle(active: boolean): React.CSSProperties {
    return {
        height: 24,
        padding: "0 8px",
        borderRadius: 8,
        border: active ? "1px solid var(--pg-primary)" : "1px solid var(--pg-border)",
        background: active ? "var(--pg-primary)" : "rgba(15, 23, 42, 0.88)",
        color: active ? "var(--pg-primary-ink)" : "var(--pg-text)",
        cursor: "pointer",
        fontWeight: 600,
        fontSize: 11,
        boxShadow: "none",
    };
}

function copyBodyButtonStyle(disabled: boolean, copyState: CopyState): React.CSSProperties {
    const baseStyle: React.CSSProperties = {
        width: 38,
        height: 38,
        marginLeft: "auto",
        padding: 0,
        borderRadius: 9,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "none",
    };

    if (disabled) {
        return {
            ...baseStyle,
            ...responseTabStyle(false),
            cursor: "not-allowed",
        };
    }

    if (copyState === "copied") {
        return {
            ...baseStyle,
            ...responseTabStyle(false),
            border: "1px solid rgba(34, 197, 94, 0.7)",
            background: "rgba(22, 163, 74, 0.16)",
            color: "#bbf7d0",
        };
    }

    if (copyState === "error") {
        return {
            ...baseStyle,
            ...responseTabStyle(false),
            border: "1px solid rgba(239, 68, 68, 0.75)",
            background: "rgba(239, 68, 68, 0.14)",
            color: "#fecaca",
        };
    }

    return {
        ...baseStyle,
        ...responseTabStyle(false),
    };
}

function copyButtonTitle(copyState: CopyState): string {
    if (copyState === "copied") return "Body copied";
    if (copyState === "error") return "Copy failed";
    return "Copy body";
}

function CopyStatusIcon({ state }: { state: CopyState }) {
    if (state === "copied") {
        return (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                    d="M20 6L9 17L4 12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        );
    }

    if (state === "error") {
        return (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                    d="M12 8V12M12 16H12.01M22 12C22 17.523 17.523 22 12 22C6.477 22 2 17.523 2 12C2 6.477 6.477 2 12 2C17.523 2 22 6.477 22 12Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        );
    }

    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M9 5H8C6.895 5 6 5.895 6 7V19C6 20.105 6.895 21 8 21H16C17.105 21 18 20.105 18 19V7C18 5.895 17.105 5 16 5H15M9 5C9 3.895 9.895 3 11 3H13C14.105 3 15 3.895 15 5M9 5C9 6.105 9.895 7 11 7H13C14.105 7 15 6.105 15 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function responsePreStyle(isJson: boolean, hasBodyModeControls: boolean): React.CSSProperties {
    return {
        margin: 0,
        background: isJson
            ? "linear-gradient(180deg, rgba(13, 28, 40, 0.98) 0%, rgba(10, 20, 35, 0.98) 100%)"
            : "var(--pg-surface-1)",
        color: "var(--pg-text-dim)",
        width: "100%",
        minWidth: 0,
        minHeight: 0,
        flex: 1,
        overflow: "auto",
        borderRadius: 12,
        border: isJson ? "1px solid rgba(var(--pg-primary-rgb), 0.38)" : "1px solid var(--pg-border)",
        padding: hasBodyModeControls ? "42px 12px 12px" : 12,
        boxSizing: "border-box",
        fontFamily: '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        boxShadow: isJson ? "inset 0 0 0 1px rgba(var(--pg-primary-rgb), 0.12)" : "none",
    };
}

function responsePreviewWrapStyle(): React.CSSProperties {
    return {
        width: "100%",
        minWidth: 0,
        minHeight: 0,
        flex: 1,
        borderRadius: 12,
        border: "1px solid var(--pg-border)",
        background: "#ffffff",
        overflow: "hidden",
    };
}

function responsePreviewFrameStyle(): React.CSSProperties {
    return {
        width: "100%",
        height: "100%",
        border: "none",
        display: "block",
    };
}

function jsonTokenStyle(type: JsonTokenType): React.CSSProperties {
    if (type === "key") {
        return { color: "#7dd3fc" };
    }
    if (type === "string") {
        return { color: "#6ee7b7" };
    }
    if (type === "number") {
        return { color: "#fbbf24" };
    }
    if (type === "boolean") {
        return { color: "#f97316" };
    }
    if (type === "null") {
        return { color: "var(--pg-text-muted)" };
    }
    return { color: "var(--pg-text-dim)" };
}

async function copyTextToClipboard(text: string): Promise<boolean> {
    if (!text) return false;

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fallback below for unsupported environments.
        }
    }

    if (typeof document === "undefined" || !document.body) {
        return false;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);

    try {
        return document.execCommand("copy");
    } catch {
        return false;
    } finally {
        document.body.removeChild(textarea);
    }
}

function responsePanelStyle(): React.CSSProperties {
    return {
        width: "100%",
        minWidth: 0,
        minHeight: 0,
        flex: 1,
        overflow: "auto",
        borderRadius: 12,
        border: "1px solid var(--pg-border)",
        background: "var(--pg-surface-1)",
        padding: 10,
        boxSizing: "border-box",
    };
}

function emptyStateStyle(): React.CSSProperties {
    return {
        color: "var(--pg-text-muted)",
        fontSize: 13,
    };
}

function tableStyle(): React.CSSProperties {
    return {
        width: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
    };
}

function thStyle(): React.CSSProperties {
    return {
        textAlign: "left",
        fontSize: 12,
        color: "var(--pg-text-muted)",
        borderBottom: "1px solid var(--pg-border)",
        padding: "8px 6px",
    };
}

function tdStyle(): React.CSSProperties {
    return {
        fontSize: 13,
        color: "var(--pg-text-dim)",
        borderBottom: "1px solid var(--pg-border)",
        padding: "8px 6px",
        verticalAlign: "top",
        wordBreak: "break-word",
    };
}

function scriptPanelStyle(): React.CSSProperties {
    return {
        border: "1px solid var(--pg-border)",
        borderRadius: 12,
        background: "var(--pg-surface-1)",
        padding: 10,
        display: "grid",
        gap: 8,
        flexShrink: 0,
    };
}

function scriptErrorStyle(): React.CSSProperties {
    return {
        fontSize: 12,
        color: "var(--pg-danger)",
        lineHeight: 1.4,
    };
}
