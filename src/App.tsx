import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPending } from "./helpers/HttpHelper";
import Editor, { type BeforeMount } from "@monaco-editor/react";
import {
    devCreate,
    devDelete,
    devDuplicate,
    devRename,
    initDefault,
    loadCollection,
    overwriteDefault,
    refreshCollections,
} from "./helpers/CollectionsHelper.ts";
import KeyValueTable from "./KeyValueTable.tsx";
import TopBar from "./TopBar.tsx";
import VariableInput, { type VariableStatus } from "./VariableInput.tsx";

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

export type EnvironmentVariable = {
    key: string;
    value: string;
};

export type Environment = {
    id: string;
    name: string;
    variables: EnvironmentVariable[];
};

type RequestContextMenu = {
    x: number;
    y: number;
    requestId: string;
};

export default function App() {
    const [collections, setCollections] = useState<CollectionMeta[]>([]);
    const [environments, setEnvironments] = useState<Environment[]>([]);
    const [activeEnvironmentId, setActiveEnvironmentId] = useState<string | null>(null);
    const [current, setCurrent] = useState<CollectionLoaded | null>(null);
    const [status, setStatus] = useState<string>("");
    const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
    const [resp, setResp] = useState<HttpResponseDto | null>(null);
    const [draftsById, setDraftsById] = useState<Record<string, Request>>({});
    const [pending, setPending] = useState(false);
    const [editorText, setEditorText] = useState("");
    const [tab, setTab] = useState<"headers" | "query" | "body" | "json">("headers");
    const [contextMenu, setContextMenu] = useState<RequestContextMenu | null>(null);
    const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
    const [renameNameInput, setRenameNameInput] = useState("");
    const [renameError, setRenameError] = useState("");
    const [renameBusy, setRenameBusy] = useState(false);
    const [environmentsModalOpen, setEnvironmentsModalOpen] = useState(false);
    const [envSelectedId, setEnvSelectedId] = useState<string | null>(null);
    const [envDraftName, setEnvDraftName] = useState("");
    const [envDraftVars, setEnvDraftVars] = useState<KeyValue[]>([]);
    const [envBusy, setEnvBusy] = useState(false);
    const [envError, setEnvError] = useState("");
    const rawJsonEditorRef = useRef<{ getValue: () => string; setValue: (value: string) => void } | null>(null);

    async function clearCurrentCollectionView() {
        setCurrent(null);
        setSelectedRequestId(null);
        setResp(null);
        setDraftsById({});
    }

    async function reloadCollectionsAndRestoreActive(preferredCollectionId?: string | null) {
        try {
            const list = await invoke<CollectionMeta[]>("list_collections");
            setCollections(list);

            let activeCollectionId =
                preferredCollectionId !== undefined
                    ? preferredCollectionId
                    : await invoke<string | null>("get_active_collection");

            if (activeCollectionId && !list.some((c) => c.id === activeCollectionId)) {
                await invoke("set_active_collection", { collectionId: null });
                activeCollectionId = null;
            }

            if (!activeCollectionId) {
                await clearCurrentCollectionView();
                setStatus("✅ No active collection");
                return;
            }

            await loadCollection(
                activeCollectionId,
                null,
                setCurrent,
                setSelectedRequestId,
                setResp,
                setStatus
            );
        } catch (e) {
            setStatus(`❌ Collections failed: ${String(e)}`);
        }
    }

    const beforeMountMonaco = useCallback<BeforeMount>((monaco) => {
        monaco.editor.defineTheme("postguerl-midnight", {
            base: "vs-dark",
            inherit: true,
            rules: [
                { token: "keyword", foreground: "7dd3fc" },
                { token: "number", foreground: "f59e0b" },
                { token: "string", foreground: "86efac" },
            ],
            colors: {
                "editor.background": "#0b1220",
                "editor.foreground": "#e2e8f0",
                "editorLineNumber.foreground": "#475569",
                "editorLineNumber.activeForeground": "#94a3b8",
                "editorCursor.foreground": "#22d3ee",
                "editor.selectionBackground": "#164e63AA",
                "editor.lineHighlightBackground": "#0f172a",
                "editorIndentGuide.background1": "#1e293b",
                "editorIndentGuide.activeBackground1": "#334155",
            },
        });
    }, []);

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
            mouseWheelScrollSensitivity: 1,
            fastScrollSensitivity: 3,
        }),
        []
    );

    const selectedSavedRequest = useMemo(() => {
        if (!current || !selectedRequestId) return null;
        return current.requests.find((r) => r.id === selectedRequestId) ?? null;
    }, [current, selectedRequestId]);

    const draft = useMemo(() => {
        if (!selectedRequestId) return null;
        return draftsById[selectedRequestId] ?? selectedSavedRequest;
    }, [draftsById, selectedRequestId, selectedSavedRequest]);

    const activeEnvironment = useMemo(
        () => environments.find((env) => env.id === activeEnvironmentId) ?? null,
        [environments, activeEnvironmentId]
    );

    const activeEnvironmentValues = useMemo(() => {
        const values = new Map<string, string>();
        for (const item of activeEnvironment?.variables ?? []) {
            const key = item.key.trim();
            if (!key) continue;
            values.set(key, item.value);
        }
        return values;
    }, [activeEnvironment]);

    const variableSuggestions = useMemo(
        () => Array.from(activeEnvironmentValues.keys()).sort((a, b) => a.localeCompare(b)),
        [activeEnvironmentValues]
    );

    const resolveVariableStatus = useCallback(
        (name: string): VariableStatus => {
            const key = name.trim();
            if (!key) return "missing";
            return activeEnvironmentValues.has(key) ? "ok" : "missing";
        },
        [activeEnvironmentValues]
    );

    const resolveVariableValue = useCallback(
        (name: string): string | undefined => {
            const key = name.trim();
            if (!key) return undefined;
            return activeEnvironmentValues.get(key);
        },
        [activeEnvironmentValues]
    );

    const isDirty = useMemo(() => {
        if (!selectedRequestId || !selectedSavedRequest || !draft) return false;
        return JSON.stringify(draft) !== JSON.stringify(selectedSavedRequest) || !!draftsById[selectedRequestId];
    }, [selectedRequestId, selectedSavedRequest, draft]);

    async function reloadEnvironments(preferredEnvironmentId?: string | null) {
        try {
            await invoke("init_default_environment");
            const list = await invoke<Environment[]>("list_environments");
            let active = await invoke<string | null>("get_active_environment");

            if (!active && list.length > 0) {
                active = list[0].id;
                await invoke("set_active_environment", { environmentId: active });
            }

            setEnvironments(list);
            setActiveEnvironmentId(active ?? null);

            const selectedCandidate =
                preferredEnvironmentId !== undefined ? preferredEnvironmentId : envSelectedId;
            const selected = list.find((e) => e.id === selectedCandidate) ??
                list.find((e) => e.id === (active ?? "")) ??
                list[0] ??
                null;

            setEnvSelectedId(selected?.id ?? null);
            setEnvDraftName(selected?.name ?? "");
            setEnvDraftVars(selected?.variables ?? []);
        } catch (e) {
            setStatus(`❌ Environments failed: ${String(e)}`);
        }
    }

    useEffect(() => {
        (async () => {
            await initDefault(setStatus, setCollections);
            await reloadCollectionsAndRestoreActive();
            await reloadEnvironments();
        })();
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
            if (rawJsonEditorRef.current) {
                rawJsonEditorRef.current.setValue("");
            }
            return;
        }
        const nextText = JSON.stringify(draft, null, 2);
        setEditorText(nextText);
        if (rawJsonEditorRef.current && rawJsonEditorRef.current.getValue() !== nextText) {
            rawJsonEditorRef.current.setValue(nextText);
        }
    }, [draft]);

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key !== "Escape") return;
            setContextMenu(null);
            if (!renameBusy) {
                setRenameTargetId(null);
                setRenameError("");
            }
            if (!envBusy) {
                setEnvironmentsModalOpen(false);
                setEnvError("");
            }
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [renameBusy, envBusy]);

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
                environmentId: activeEnvironmentId,
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

    function setSelection(r: Request) {
        setSelectedRequestId(r.id);
        setResp(null);
    }

    function onDeleteRequest(requestId: string) {
        if (!current) return;

        setDraftsById((prev) => {
            const next = { ...prev };
            delete next[requestId];
            return next;
        });

        devDelete(
            current,
            requestId,
            setCurrent,
            setSelectedRequestId,
            setResp,
            setStatus
        );
    }

    function onDuplicateRequest(requestId: string) {
        if (!current) return;

        devDuplicate(
            current,
            requestId,
            setCurrent,
            setSelectedRequestId,
            setResp,
            setStatus
        );
    }

    function openRenameModal(requestId: string) {
        if (!current) return;
        const req = current.requests.find((r) => r.id === requestId);
        if (!req) return;

        setRenameTargetId(requestId);
        setRenameNameInput(req.name);
        setRenameError("");
        setContextMenu(null);
    }

    function closeRenameModal() {
        if (renameBusy) return;
        setRenameTargetId(null);
        setRenameError("");
    }

    async function submitRenameModal() {
        if (!current || !renameTargetId || renameBusy) return;

        const nextName = renameNameInput.trim();

        if (!nextName) {
            setRenameError("Request name cannot be empty.");
            return;
        }

        const source = current.requests.find((r) => r.id === renameTargetId);
        if (!source) {
            setRenameError("Source request not found.");
            return;
        }

        if (nextName === source.name) {
            setRenameError("Nothing to rename.");
            return;
        }

        setRenameBusy(true);
        setRenameError("");

        const ok = await devRename(
            current,
            renameTargetId,
            nextName,
            setCurrent,
            setSelectedRequestId,
            setResp,
            setStatus
        );

        if (ok) {
            setDraftsById((prev) => {
                const existing = prev[renameTargetId];
                if (!existing) return prev;
                const next = { ...prev };
                next[renameTargetId] = { ...existing, name: nextName };
                return next;
            });

            setRenameTargetId(null);
            setRenameError("");
        }
        setRenameBusy(false);
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

    async function onSelectEnvironment(environmentId: string | null) {
        try {
            await invoke("set_active_environment", { environmentId });
            setActiveEnvironmentId(environmentId);
            setStatus(environmentId ? "✅ Environment selected" : "✅ Environment cleared");
        } catch (e) {
            setStatus(`❌ Environment select failed: ${String(e)}`);
        }
    }

    async function onSelectCollection(collectionId: string | null) {
        try {
            await invoke("set_active_collection", { collectionId });

            if (!collectionId) {
                await clearCurrentCollectionView();
                setStatus("✅ Collection cleared");
                return;
            }

            await loadCollection(
                collectionId,
                null,
                setCurrent,
                setSelectedRequestId,
                setResp,
                setStatus
            );
        } catch (e) {
            setStatus(`❌ Collection select failed: ${String(e)}`);
        }
    }

    function openEnvironmentsModal() {
        const selected = environments.find((e) => e.id === activeEnvironmentId) ?? environments[0] ?? null;
        setEnvSelectedId(selected?.id ?? null);
        setEnvDraftName(selected?.name ?? "");
        setEnvDraftVars(selected?.variables ?? []);
        setEnvError("");
        setEnvironmentsModalOpen(true);
    }

    function closeEnvironmentsModal() {
        if (envBusy) return;
        setEnvironmentsModalOpen(false);
        setEnvError("");
    }

    function pickEnvironmentForEdit(environmentId: string) {
        const env = environments.find((e) => e.id === environmentId);
        if (!env) return;
        setEnvSelectedId(env.id);
        setEnvDraftName(env.name);
        setEnvDraftVars(env.variables);
        setEnvError("");
    }

    async function onCreateEnvironment() {
        if (envBusy) return;
        setEnvBusy(true);
        setEnvError("");
        try {
            const created = await invoke<Environment>("create_environment", { name: "New Environment" });
            await reloadEnvironments(created.id);
            setStatus("✅ Environment created");
        } catch (e) {
            setEnvError(`Create failed: ${String(e)}`);
        } finally {
            setEnvBusy(false);
        }
    }

    async function onDuplicateEnvironment() {
        if (!envSelectedId || envBusy) return;
        setEnvBusy(true);
        setEnvError("");
        try {
            const duplicated = await invoke<Environment>("duplicate_environment", {
                sourceEnvironmentId: envSelectedId,
                newName: `${envDraftName || "Environment"} Copy`,
            });
            await reloadEnvironments(duplicated.id);
            setStatus("✅ Environment duplicated");
        } catch (e) {
            setEnvError(`Duplicate failed: ${String(e)}`);
        } finally {
            setEnvBusy(false);
        }
    }

    async function onDeleteEnvironment() {
        if (!envSelectedId || envBusy) return;
        setEnvBusy(true);
        setEnvError("");
        try {
            await invoke("delete_environment", { environmentId: envSelectedId });
            await reloadEnvironments();
            setStatus("✅ Environment deleted");
        } catch (e) {
            setEnvError(`Delete failed: ${String(e)}`);
        } finally {
            setEnvBusy(false);
        }
    }

    async function onSaveEnvironment() {
        if (!envSelectedId || envBusy) return;
        const name = envDraftName.trim();
        if (!name) {
            setEnvError("Environment name cannot be empty.");
            return;
        }

        setEnvBusy(true);
        setEnvError("");
        try {
            await invoke("save_environment", {
                environment: {
                    id: envSelectedId,
                    name,
                    variables: envDraftVars,
                },
            });
            await reloadEnvironments(envSelectedId);
            setStatus("✅ Environment saved");
        } catch (e) {
            setEnvError(`Save failed: ${String(e)}`);
        } finally {
            setEnvBusy(false);
        }
    }

    return (
        <>
            <TopBar
                collections={collections}
                currentCollectionId={current?.meta.id ?? null}
                environments={environments}
                currentEnvironmentId={activeEnvironmentId}
                onSelectCollection={(collectionId) => void onSelectCollection(collectionId || null)}
                onSelectEnvironment={onSelectEnvironment}
                onManageEnvironments={openEnvironmentsModal}
                onSaveDraft={saveDraft}
                onNewRequest={onNewRequest}
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

                        <button
                            onClick={async () => {
                                await initDefault(setStatus, setCollections);
                                await reloadCollectionsAndRestoreActive();
                            }}
                        >
                            Init default
                        </button>
                        <button
                            onClick={async () => {
                                await refreshCollections(setCollections, setStatus);
                                await reloadCollectionsAndRestoreActive();
                            }}
                        >
                            Refresh
                        </button>
                        <button
                            onClick={async () => {
                                await overwriteDefault(setStatus, setCollections);
                                await reloadCollectionsAndRestoreActive();
                            }}
                        >
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
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                setSelection(r);
                                                setContextMenu({
                                                    x: e.clientX,
                                                    y: e.clientY,
                                                    requestId: r.id,
                                                });
                                            }}
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

                                <VariableInput
                                    placeholder="URL"
                                    value={draft.url}
                                    onChange={(nextUrl) => updateDraft({ url: nextUrl })}
                                    resolveVariableStatus={resolveVariableStatus}
                                    resolveVariableValue={resolveVariableValue}
                                    variableSuggestions={variableSuggestions}
                                    containerStyle={{ flex: 1 }}
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
                                    resolveVariableStatus={resolveVariableStatus}
                                    resolveVariableValue={resolveVariableValue}
                                    variableSuggestions={variableSuggestions}
                                />
                            )}

                            {tab === "query" && (
                                <KeyValueTable
                                    rows={draft.query}
                                    onChange={(next) => updateDraft({ query: next })}
                                    resolveVariableStatus={resolveVariableStatus}
                                    resolveVariableValue={resolveVariableValue}
                                    variableSuggestions={variableSuggestions}
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
                                <div style={editorPanelStyle("34vh", 280)}>
                                    <Editor
                                        key={`body-json-${selectedRequestId ?? "none"}`}
                                        height="100%"
                                        language="json"
                                        theme="postguerl-midnight"
                                        beforeMount={beforeMountMonaco}
                                        defaultValue={JSON.stringify(draft.body.value ?? {}, null, 2)}
                                        onChange={(value) => {
                                            try {
                                                const parsed = JSON.parse(value ?? "{}");
                                                setFullDraft({
                                                    ...draft,
                                                    body: { type: "json", value: parsed },
                                                });
                                            } catch {
                                                // keep last valid value while user types invalid json
                                            }
                                        }}
                                        options={editorOptions}
                                    />
                                </div>
                            )}

                            {tab === "body" && draft.body.type === "raw" && (() => {
                                const rawBody = draft.body;
                                return (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                        <VariableInput
                                            placeholder="Content-Type"
                                            value={rawBody.content_type}
                                            onChange={(nextContentType) =>
                                                setFullDraft({
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
                                                theme="postguerl-midnight"
                                                beforeMount={beforeMountMonaco}
                                                defaultValue={rawBody.text}
                                                onChange={(value) =>
                                                    setFullDraft({
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

                            {tab === "body" && draft.body.type === "form" && (
                                <KeyValueTable
                                    rows={draft.body.fields}
                                    onChange={(next) =>
                                        setFullDraft({
                                            ...draft,
                                            body: { type: "form", fields: next },
                                        })
                                    }
                                    resolveVariableStatus={resolveVariableStatus}
                                    resolveVariableValue={resolveVariableValue}
                                    variableSuggestions={variableSuggestions}
                                />
                            )}

                            {tab === "json" && (
                                <>
                                    <div style={editorPanelStyle("52vh", 360)}>
                                        <Editor
                                            key={`request-json-${selectedRequestId ?? "none"}`}
                                            height="100%"
                                            language="json"
                                            theme="postguerl-midnight"
                                            beforeMount={beforeMountMonaco}
                                            defaultValue={editorText}
                                            onMount={(editor) => {
                                                rawJsonEditorRef.current = editor as {
                                                    getValue: () => string;
                                                    setValue: (value: string) => void;
                                                };
                                                if (editor.getValue() !== editorText) {
                                                    editor.setValue(editorText);
                                                }
                                            }}
                                            options={{ ...editorOptions, readOnly: true, domReadOnly: true }}
                                        />
                                    </div>
                                    <div style={{ fontSize: 13, color: "#9ca3af" }}>
                                        Dev view: request object (read-only)
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

            {contextMenu && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 1200,
                    }}
                    onClick={() => setContextMenu(null)}
                >
                    <div
                        style={{
                            position: "fixed",
                            top: contextMenu.y,
                            left: contextMenu.x,
                            minWidth: 180,
                            padding: 6,
                            borderRadius: 10,
                            border: "1px solid #3a3a3c",
                            background: "#1f1f22",
                            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            style={{ ...buttonStyle(false), width: "100%", textAlign: "left" }}
                            onClick={() => openRenameModal(contextMenu.requestId)}
                        >
                            Rename
                        </button>
                        <button
                            style={{ ...buttonStyle(false), width: "100%", textAlign: "left" }}
                            onClick={() => {
                                setContextMenu(null);
                                onDuplicateRequest(contextMenu.requestId);
                            }}
                        >
                            Duplicate
                        </button>
                        <button
                            style={{
                                ...buttonStyle(false),
                                width: "100%",
                                textAlign: "left",
                                color: "#fca5a5",
                                borderColor: "#7f1d1d",
                            }}
                            onClick={() => {
                                setContextMenu(null);
                                onDeleteRequest(contextMenu.requestId);
                            }}
                        >
                            Delete
                        </button>
                    </div>
                </div>
            )}

            {renameTargetId && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 1300,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                    }}
                    onMouseDown={closeRenameModal}
                >
                    <form
                        onMouseDown={(e) => e.stopPropagation()}
                        onSubmit={(e) => {
                            e.preventDefault();
                            void submitRenameModal();
                        }}
                        style={{
                            width: "100%",
                            maxWidth: 460,
                            border: "1px solid #3a3a3c",
                            borderRadius: 12,
                            background: "#1f1f22",
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                        }}
                    >
                        <h3 style={{ margin: 0 }}>Rename request</h3>

                        <div style={{ fontSize: 13, color: "#a1a1aa" }}>
                            Request id:{" "}
                            <code style={{ color: "#f4f4f5" }}>
                                {renameTargetId}
                            </code>
                        </div>

                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={{ fontSize: 13, color: "#a1a1aa" }}>Request name</span>
                            <input
                                value={renameNameInput}
                                onChange={(e) => setRenameNameInput(e.target.value)}
                                disabled={renameBusy}
                            />
                        </label>

                        {renameError && <div style={{ color: "#fca5a5", fontSize: 13 }}>{renameError}</div>}

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                            <button type="button" onClick={closeRenameModal} style={buttonStyle(renameBusy)}>
                                Cancel
                            </button>
                            <button type="submit" disabled={renameBusy} style={primaryButtonStyle(renameBusy)}>
                                {renameBusy ? "Renaming..." : "Rename"}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {environmentsModalOpen && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 1400,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                    }}
                    onMouseDown={closeEnvironmentsModal}
                >
                    <div
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 900,
                            height: "78vh",
                            maxHeight: 700,
                            border: "1px solid #3a3a3c",
                            borderRadius: 12,
                            background: "#1f1f22",
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <h3 style={{ margin: 0 }}>Environments</h3>
                            <button onClick={closeEnvironmentsModal} style={buttonStyle(envBusy)}>
                                Close
                            </button>
                        </div>

                        <div style={{ display: "flex", gap: 12, minHeight: 0, flex: 1 }}>
                            <div
                                style={{
                                    width: 260,
                                    display: "flex",
                                    flexDirection: "column",
                                    minHeight: 0,
                                    gap: 8,
                                }}
                            >
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button onClick={onCreateEnvironment} style={buttonStyle(envBusy)}>+ New</button>
                                    <button
                                        onClick={onDuplicateEnvironment}
                                        disabled={!envSelectedId || envBusy}
                                        style={buttonStyle(!envSelectedId || envBusy)}
                                    >
                                        Duplicate
                                    </button>
                                </div>
                                <button
                                    onClick={onDeleteEnvironment}
                                    disabled={!envSelectedId || envBusy}
                                    style={buttonStyle(!envSelectedId || envBusy)}
                                >
                                    Delete
                                </button>

                                <div style={{ overflowY: "auto", minHeight: 0, flex: 1, paddingRight: 4 }}>
                                    {environments.map((env) => (
                                        <button
                                            key={env.id}
                                            onClick={() => pickEnvironmentForEdit(env.id)}
                                            style={{
                                                ...buttonStyle(false),
                                                width: "100%",
                                                marginBottom: 6,
                                                textAlign: "left",
                                                borderColor: env.id === envSelectedId ? "#2563eb" : "#3a3a3c",
                                            }}
                                        >
                                            {env.name}
                                            {env.id === activeEnvironmentId ? " (active)" : ""}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div
                                style={{
                                    flex: 1,
                                    display: "flex",
                                    flexDirection: "column",
                                    minHeight: 0,
                                    gap: 12,
                                }}
                            >
                                {!envSelectedId && (
                                    <div style={{ color: "#9ca3af" }}>No environment selected.</div>
                                )}

                                {envSelectedId && (
                                    <>
                                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                            <span style={{ fontSize: 13, color: "#a1a1aa" }}>Name</span>
                                            <input
                                                value={envDraftName}
                                                onChange={(e) => setEnvDraftName(e.target.value)}
                                                disabled={envBusy}
                                            />
                                        </label>

                                        <div style={{ fontSize: 13, color: "#9ca3af" }}>
                                            Use variables in requests with <code>{"{{variable_name}}"}</code>.
                                        </div>

                                        <div style={{ minHeight: 0, overflowY: "auto", flex: 1, paddingRight: 4 }}>
                                            <KeyValueTable rows={envDraftVars} onChange={setEnvDraftVars} />
                                        </div>

                                        {envError && <div style={{ color: "#fca5a5", fontSize: 13 }}>{envError}</div>}

                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                            <button
                                                onClick={() => void onSelectEnvironment(envSelectedId)}
                                                disabled={envBusy}
                                                style={buttonStyle(envBusy)}
                                            >
                                                Set Active
                                            </button>
                                            <button
                                                onClick={onSaveEnvironment}
                                                disabled={envBusy}
                                                style={primaryButtonStyle(envBusy)}
                                            >
                                                Save Environment
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function buttonStyle(disabled: boolean): React.CSSProperties {
    return {
        height: 32,
        padding: "0 12px",
        borderRadius: 8,
        border: "1px solid #3a3a3c",
        background: disabled ? "#2a2a2a" : "#2c2c2e",
        color: disabled ? "#6b7280" : "#f4f4f5",
        cursor: disabled ? "not-allowed" : "pointer",
    };
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
    return {
        height: 32,
        padding: "0 12px",
        borderRadius: 8,
        border: "1px solid #2563eb",
        background: disabled ? "#1f2937" : "#2563eb",
        color: "#ffffff",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 600,
    };
}

function editorPanelStyle(height: number | string, minHeight = 220): React.CSSProperties {
    return {
        height,
        minHeight,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid #1e293b",
        boxShadow: "inset 0 0 0 1px #0f172a, 0 14px 28px rgba(2, 6, 23, 0.35)",
        background:
            "linear-gradient(180deg, rgba(15,23,42,0.96) 0%, rgba(11,18,32,0.98) 100%)",
    };
}

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
