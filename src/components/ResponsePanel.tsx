import { useMemo } from "react";
import type { HttpResponseDto } from "../types.ts";

export type ResponseTabId = "body" | "cookies" | "headers" | "runtime";

type CookieItem = {
    name: string;
    value: string;
    attributes: string;
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
    const parsedBody = useMemo(() => formatResponseBody(response), [response]);
    const cookies = useMemo(() => extractCookies(response), [response]);
    const hasScriptInfo = !!scriptReport && (
        !!scriptReport.preRequestError ||
        !!scriptReport.postResponseError ||
        scriptReport.tests.length > 0
    );

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

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
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
                <pre style={responsePreStyle()}>
                    {parsedBody}
                </pre>
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

function formatResponseBody(response: HttpResponseDto | null): string {
    if (!response) return "No response yet.";
    if (!response.body_text) return "(empty body)";

    const contentType = findHeaderValue(response, "content-type")?.toLowerCase() ?? "";
    const raw = response.body_text;
    const looksLikeJson =
        contentType.includes("application/json") ||
        contentType.includes("+json") ||
        raw.trim().startsWith("{") ||
        raw.trim().startsWith("[");

    if (!looksLikeJson) return raw;

    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return raw;
    }
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

function responsePreStyle(): React.CSSProperties {
    return {
        margin: 0,
        background: "var(--pg-surface-1)",
        color: "var(--pg-text-dim)",
        width: "100%",
        minWidth: 0,
        minHeight: 0,
        flex: 1,
        overflow: "auto",
        borderRadius: 12,
        border: "1px solid var(--pg-border)",
        padding: 12,
        boxSizing: "border-box",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
    };
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
