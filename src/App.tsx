import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPending } from "./helpers/HttpHelper";
import Editor from "@monaco-editor/react";
import {
    devCreate,
    devDelete,
    initDefault,
    loadCollection,
    overwriteDefault,
    refreshCollections,
} from "./helpers/CollectionsHelper.ts";
import KeyValueTable from "./KeyValueTable.tsx";
import TopBar from "./TopBar.tsx";

export type CollectionMeta = {
    version: number;
    id: string;
    name: string;
    request_order: string[];
};

export type KeyValue = { key: string; value: string };

export type Body =
    | { type: "none" }
    | { type: "raw"; content_type: string; text: string }
    | { type: "json"; value: any }
    | { type: "form"; fields: KeyValue[] };

export type Request = {
    id: string;
    name: string;
    method: "get" | "post" | "put" | "patch" | "delete" | "head" | "options";
    url: string;
    headers: KeyValue[];
    query: KeyValue[];
    body: Body;
};

export type CollectionLoaded = {
    meta: CollectionMeta;
    requests: Request[];
};

export type HttpResponseDto = {
    status: number;
    headers: { key: string; value: string }[];
    body_text: string;
    duration_ms: number;
};

export default function App() {
    const [collections, setCollections] = useState<CollectionMeta[]>([]);
    const [current, setCurrent] = useState<CollectionLoaded | null>(null);
    const [status, setStatus] = useState<string>("");
    const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
    const [resp, setResp] = useState<HttpResponseDto | null>(null);
    const [draftsById, setDraftsById] = useState<Record<string, Request>>({});
    const [pending, setPending] = useState(false);
    const [editorText, setEditorText] = useState("");
    const [tab, setTab] = useState<"headers" | "query" | "body" | "json">("headers");

    const selectedSavedRequest = useMemo(() => {
        if (!current || !selectedRequestId) return null;
        return current.requests.find((r) => r.id === selectedRequestId) ?? null;
    }, [current, selectedRequestId]);

    const draft = useMemo(() => {
        if (!selectedRequestId) return null;
        return draftsById[selectedRequestId] ?? selectedSavedRequest;
    }, [draftsById, selectedRequestId, selectedSavedRequest]);

    const isDirty = useMemo(() => {
        if (!selectedRequestId || !selectedSavedRequest || !draft) return false;
        return JSON.stringify(draft) !== JSON.stringify(selectedSavedRequest) || !!draftsById[selectedRequestId];
    }, [selectedRequestId, selectedSavedRequest, draft]);

    useEffect(() => {
        initDefault(setStatus, setCollections);
    }, []);
    useEffect(() => {
        if (!current) return;
        console.log("Loading drafts for collection", current.meta.id);
        (async () => {
            try {
                const drafts = await invoke<Record<string, Request>>("load_drafts", {
                    collectionId: current.meta.id,
                });
                setDraftsById(drafts);
            } catch (e) {
                setStatus(`❌ Failed to load drafts: ${String(e)}`);
            }
        })();
    }, [current?.meta.id]);

    useEffect(() => {
        if (!current) return;

        const timeout = setTimeout(() => {
            void invoke("save_drafts", {
                collectionId: current.meta.id,
                drafts: draftsById,
            });
        }, 300);

        return () => clearTimeout(timeout);
    }, [draftsById, current?.meta.id]);

    useEffect(() => {
        if (!selectedRequestId) {
            setPending(false);
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                const p = await isPending(selectedRequestId);
                if (!cancelled) setPending(p);
            } catch {
                if (!cancelled) setPending(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [selectedRequestId]);

    useEffect(() => {
        if (!draft) {
            setEditorText("");
            return;
        }
        setEditorText(JSON.stringify(draft, null, 2));
    }, [draft]);

    const updateDraft = useCallback(
        (patch: Partial<Request>) => {
            if (!selectedRequestId || !draft) return;

            setDraftsById((prev) => ({
                ...prev,
                [selectedRequestId]: {
                    ...draft,
                    ...patch,
                },
            }));
        },
        [selectedRequestId, draft]
    );

    const setFullDraft = useCallback(
        (next: Request) => {
            if (!selectedRequestId) return;

            setDraftsById((prev) => ({
                ...prev,
                [selectedRequestId]: next,
            }));
        },
        [selectedRequestId]
    );

    const saveDraft = useCallback(async () => {
        if (!current || !selectedRequestId || !draft) return;

        try {
            await invoke("update_request", {
                collectionId: current.meta.id,
                request: draft,
            });

            setDraftsById((prev) => {
                const next = { ...prev };
                delete next[selectedRequestId];
                return next;
            });

            await loadCollection(
                current.meta.id,
                draft.id,
                setCurrent,
                setSelectedRequestId,
                setResp,
                setStatus
            );
            setStatus("✅ Draft saved");
        } catch (e) {
            setStatus(`❌ Save failed: ${String(e)}`);
        }
    }, [current, selectedRequestId, draft]);

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            const isSaveShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s";
            if (!isSaveShortcut) return;

            e.preventDefault();
            if (isDirty) {
                void saveDraft();
            }
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isDirty, saveDraft]);

    async function sendSelected() {
        if (!selectedRequestId) return;

        const req =
            draft && draft.id === selectedRequestId
                ? draft
                : current?.requests.find((r) => r.id === selectedRequestId);

        if (!req) return;

        setResp(null);
        setPending(true);
        setStatus("Sending...");

        try {
            const r = await invoke<HttpResponseDto>("send_request", {
                requestId: selectedRequestId,
                req,
            });
            setResp(r);
            setStatus(`✅ ${r.status} in ${r.duration_ms}ms`);
        } catch (e: any) {
            const kind = e?.kind ?? "unknown";
            const msg = e?.message ?? String(e);
            const d = e?.duration_ms;
            setStatus(`❌ ${kind}: ${msg}${d != null ? ` (${d}ms)` : ""}`);
        } finally {
            const p = await isPending(selectedRequestId).catch(() => false);
            setPending(p);
        }
    }

    async function cancel() {
        if (!selectedRequestId) return;

        try {
            await invoke("cancel_request", { requestId: selectedRequestId });
            setStatus("⛔ Cancel requested");
        } catch (e) {
            setStatus(`❌ Cancel failed: ${String(e)}`);
        } finally {
            const p = await isPending(selectedRequestId).catch(() => false);
            setPending(p);
        }
    }

    function formatJson() {
        try {
            const obj = JSON.parse(editorText);
            setEditorText(JSON.stringify(obj, null, 2));
            setStatus("✅ Formatted");
        } catch (e) {
            setStatus(`❌ JSON invalid: ${String(e)}`);
        }
    }

    function setSelection(r: Request) {
        setSelectedRequestId(r.id);
        setResp(null);
    }

    function applyEditorToDraft() {
        if (!draft) return;

        try {
            const parsed = JSON.parse(editorText) as Request;
            if (parsed.id !== draft.id) {
                setStatus("❌ ID cannot be changed here. Use Rename.");
                return;
            }
            setFullDraft(parsed);
            setStatus("✅ JSON applied to draft");
        } catch (e) {
            setStatus(`❌ JSON invalid: ${String(e)}`);
        }
    }

    function onDeleteSelectedRequest() {
        if (!current || !selectedRequestId) return;

        setDraftsById((prev) => {
            const next = { ...prev };
            delete next[selectedRequestId];
            return next;
        });

        devDelete(
            current,
            selectedRequestId,
            setCurrent,
            setSelectedRequestId,
            setResp,
            setStatus
        );
    }

    function onNewRequest() {
        if (!current) return;
        devCreate(
            current,
            setCurrent,
            setSelectedRequestId,
            setResp,
            setStatus,
            setSelection
        );
    }

    return (
        <>
            <TopBar
                collections={collections}
                currentCollectionId={current?.meta.id ?? null}
                onSelectCollection={(collectionId) =>
                    loadCollection(collectionId,null, setCurrent, setSelectedRequestId, setResp, setStatus)
                }
                onSaveDraft={saveDraft}
                onNewRequest={onNewRequest}
                onDeleteSelectedRequest={onDeleteSelectedRequest}
                onOpenRawJson={() => setTab("json")}
                canSaveDraft={!!current && !!draft && isDirty}
                hasDraft={!!draft}
            />

            <div
                style={{
                    height: "calc(100vh - 52px)",
                    padding: "10px 24px",
                    fontFamily: "system-ui",
                    display: "flex",
                    gap: 24,
                    overflow: "hidden",
                    boxSizing: "border-box",
                }}
            >
                {/* Sidebar */}
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        width: 240,
                        height: "100%",
                        minHeight: 0,
                        flexShrink: 0,
                    }}
                >
                    <div>
                        <h3>Collections</h3>

                        <button onClick={() => initDefault(setStatus, setCollections)}>Init default</button>
                        <button onClick={() => refreshCollections(setCollections, setStatus)}>Refresh</button>
                        <button onClick={() => overwriteDefault(setStatus, setCollections)}>
                            Overwrite default
                        </button>
                        <button onClick={() => invoke("open_app_data_dir")}>Open data folder</button>
                    </div>

                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            minHeight: 0,
                            flex: 1,
                            overflow: "hidden",
                        }}
                    >
                        <h3 style={{ marginTop: 16, marginBottom: 8, flexShrink: 0 }}>Requests</h3>

                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                                overflowY: "auto",
                                minHeight: 0,
                                flex: 1,
                                paddingRight: 4,
                            }}
                        >
                            {current &&
                                current.requests.map((r) => {
                                    const hasLocalDraft = !!draftsById[r.id];

                                    return (
                                        <button
                                            key={r.id}
                                            onClick={() => setSelection(r)}
                                            style={{
                                                fontWeight: r.id === selectedRequestId ? "bold" : "normal",
                                                width: "100%",
                                                padding: "8px",
                                                textAlign: "left",
                                                flexShrink: 0,
                                            }}
                                        >
                                            {r.method} {r.name} {hasLocalDraft ? "●" : ""}
                                        </button>
                                    );
                                })}
                        </div>
                    </div>
                </div>

                {/* Main */}
                <div
                    style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        minWidth: 0,
                        minHeight: 0,
                        overflow: "hidden",
                    }}
                >
                    {current && draft && (
                        <>
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    gap: 8,
                                    marginTop: 12,
                                }}
                            >
                                <h3>Editor</h3>
                                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                    {isDirty && <span style={{ color: "#f59e0b" }}>● Unsaved</span>}
                                    {selectedRequestId ? (pending ? "⏳ pending" : "✅ idle") : ""}
                                </div>
                            </div>

                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <select
                                    value={draft.method}
                                    onChange={(e) =>
                                        updateDraft({ method: e.target.value as Request["method"] })
                                    }
                                >
                                    <option value="get">GET</option>
                                    <option value="post">POST</option>
                                    <option value="put">PUT</option>
                                    <option value="patch">PATCH</option>
                                    <option value="delete">DELETE</option>
                                    <option value="head">HEAD</option>
                                    <option value="options">OPTIONS</option>
                                </select>

                                <input
                                    placeholder="URL"
                                    value={draft.url}
                                    onChange={(e) => updateDraft({ url: e.target.value })}
                                    style={{ flex: 1 }}
                                />

                                <button onClick={sendSelected} disabled={!selectedRequestId || pending}>
                                    Send
                                </button>

                                <button onClick={cancel} disabled={!selectedRequestId || !pending}>
                                    Cancel
                                </button>
                            </div>

                            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                <button
                                    onClick={() => setTab("headers")}
                                    style={{ fontWeight: tab === "headers" ? "bold" : "normal" }}
                                >
                                    Headers
                                </button>
                                <button
                                    onClick={() => setTab("query")}
                                    style={{ fontWeight: tab === "query" ? "bold" : "normal" }}
                                >
                                    Query
                                </button>
                                <button
                                    onClick={() => setTab("body")}
                                    style={{ fontWeight: tab === "body" ? "bold" : "normal" }}
                                >
                                    Body
                                </button>
                            </div>

                            {tab === "headers" && (
                                <KeyValueTable
                                    rows={draft.headers}
                                    onChange={(next) => updateDraft({ headers: next })}
                                />
                            )}

                            {tab === "query" && (
                                <KeyValueTable
                                    rows={draft.query}
                                    onChange={(next) => updateDraft({ query: next })}
                                />
                            )}

                            {tab === "body" && (
                                <select
                                    value={draft.body.type}
                                    onChange={(e) => {
                                        const t = e.target.value as Body["type"];
                                        const body: Body =
                                            t === "none"
                                                ? { type: "none" }
                                                : t === "json"
                                                    ? { type: "json", value: {} }
                                                    : t === "raw"
                                                        ? { type: "raw", content_type: "text/plain", text: "" }
                                                        : { type: "form", fields: [] };

                                        updateDraft({ body });
                                    }}
                                >
                                    <option value="none">none</option>
                                    <option value="json">json</option>
                                    <option value="raw">raw</option>
                                    <option value="form">form</option>
                                </select>
                            )}

                            {tab === "body" && draft.body.type === "json" && (
                                <Editor
                                    height="220px"
                                    language="json"
                                    theme="vs-dark"
                                    value={JSON.stringify(draft.body.value, null, 2)}
                                    onChange={(v) => {
                                        try {
                                            const parsed = JSON.parse(v ?? "{}");
                                            setFullDraft({
                                                ...draft,
                                                body: { type: "json", value: parsed },
                                            });
                                        } catch {
                                            // On laisse l'utilisateur finir de taper
                                        }
                                    }}
                                    options={{ minimap: { enabled: false }, tabSize: 2 }}
                                />
                            )}

                            {tab === "body" && draft.body.type === "raw" && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    <input
                                        placeholder="Content-Type"
                                        value={draft.body.content_type}
                                        onChange={(e) =>
                                            setFullDraft({
                                                ...draft,
                                                body: {
                                                    ...draft.body,
                                                    content_type: e.target.value,
                                                },
                                            })
                                        }
                                    />
                                    <Editor
                                        height="220px"
                                        language="text"
                                        theme="vs-dark"
                                        value={draft.body.text}
                                        onChange={(v) =>
                                            setFullDraft({
                                                ...draft,
                                                body: {
                                                    ...draft.body,
                                                    text: v ?? "",
                                                },
                                            })
                                        }
                                        options={{ minimap: { enabled: false }, tabSize: 2 }}
                                    />
                                </div>
                            )}

                            {tab === "body" && draft.body.type === "form" && (
                                <KeyValueTable
                                    rows={draft.body.fields}
                                    onChange={(next) =>
                                        setFullDraft({
                                            ...draft,
                                            body: { type: "form", fields: next },
                                        })
                                    }
                                />
                            )}

                            {tab === "json" && (
                                <>
                                    <Editor
                                        height="400px"
                                        language="json"
                                        theme="vs-dark"
                                        value={editorText}
                                        onChange={(v) => setEditorText(v ?? "")}
                                        options={{ minimap: { enabled: false }, tabSize: 2 }}
                                    />
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <button onClick={applyEditorToDraft} disabled={!draft}>
                                            Apply JSON
                                        </button>
                                        <button onClick={formatJson} disabled={!current}>
                                            Format JSON
                                        </button>
                                    </div>
                                </>
                            )}

                            <div
                                style={{
                                    display: "flex",
                                    gap: 8,
                                    flexDirection: "column",
                                    width: "100%",
                                    minHeight: 0,
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 8,
                                        marginTop: "2em",
                                    }}
                                >
                                    <div>
                                        <h3 style={{ margin: 0 }}>Response</h3>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <h3 style={{ margin: 0 }}>Status</h3>
                                        <div>{status}</div>
                                    </div>
                                </div>

                                <pre
                                    style={{
                                        background: "#111",
                                        color: "#eee",
                                        width: "100%",
                                        height: "40vh",
                                        overflow: "auto",
                                    }}
                                >
                  {resp ? JSON.stringify(resp, null, 2) : "No response yet."}
                </pre>
                            </div>
                        </>
                    )}

                    {!current && (
                        <>
                            <h3 style={{ marginTop: 16 }}>Loaded collection</h3>
                            <pre style={{ background: "#111", color: "#eee", padding: 12 }}>None</pre>
                        </>
                    )}
                </div>
            </div>
        </>
    );
}