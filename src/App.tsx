import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPending } from "./helpers/HttpHelper";
import Editor from "@monaco-editor/react";
import {
    devCreate,
    devDelete,
    devDuplicate,
    devRename,
    initDefault,
    loadCollection,
} from "./helpers/CollectionsHelper.ts";
import KeyValueTable from "./KeyValueTable.tsx";
import TopBar from "./TopBar.tsx";
import VariableInput, { type VariableStatus } from "./VariableInput.tsx";
import RequestBodyEditor from "./components/RequestBodyEditor.tsx";
import CollectionsModal from "./components/CollectionsModal.tsx";
import EnvironmentsModal from "./components/EnvironmentsModal.tsx";
import ResponsePanel, { type ResponseTabId } from "./components/ResponsePanel.tsx";
import { useMonacoVariableSupport } from "./hooks/useMonacoVariableSupport.ts";
import {
    buttonStyle,
    dangerButtonStyle,
    primaryButtonStyle,
    selectStyle,
} from "./helpers/UiStyles.ts";
import type {
    CollectionLoaded,
    CollectionMeta,
    Environment,
    HttpResponseDto,
    KeyValue,
    Request,
} from "./types.ts";

type RequestContextMenu = {
    x: number;
    y: number;
    requestId: string;
};

type CloseDraftModal = {
    requestId: string;
};

type RequestDropIndicator = {
    requestId: string;
    position: "before" | "after";
};

type DeleteCollectionModal = {
    id: string;
    name: string;
};

type PersistedTabsEntry = {
    openRequestIds: string[];
    activeRequestId: string | null;
};

type PersistedTabsState = Record<string, PersistedTabsEntry>;

type PersistedResponseEntry = {
    response: HttpResponseDto | null;
    statusText: string;
    updatedAt: string;
};

type PersistedResponsesCollection = Record<string, PersistedResponseEntry>;
type PersistedResponsesState = Record<string, PersistedResponsesCollection>;

const OPEN_TABS_STORAGE_KEY = "postguerl:open-tabs:v1";
const RESPONSES_STORAGE_KEY = "postguerl:last-responses:v1";

function readPersistedTabsState(): PersistedTabsState {
    if (typeof window === "undefined") return {};

    try {
        const raw = window.localStorage.getItem(OPEN_TABS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") return {};
        return parsed as PersistedTabsState;
    } catch {
        return {};
    }
}

function sanitizePersistedTabsEntry(entry: unknown): PersistedTabsEntry {
    if (!entry || typeof entry !== "object") {
        return { openRequestIds: [], activeRequestId: null };
    }

    const source = entry as { openRequestIds?: unknown; activeRequestId?: unknown };
    const openRequestIds = Array.isArray(source.openRequestIds)
        ? source.openRequestIds.filter((id): id is string => typeof id === "string")
        : [];
    const activeRequestId = typeof source.activeRequestId === "string" ? source.activeRequestId : null;

    return { openRequestIds, activeRequestId };
}

function writePersistedTabsState(state: PersistedTabsState) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(OPEN_TABS_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // ignore storage write failures
    }
}

function sanitizeHttpResponse(input: unknown): HttpResponseDto | null {
    if (!input || typeof input !== "object") return null;
    const source = input as Record<string, unknown>;
    if (
        typeof source.status !== "number" ||
        !Array.isArray(source.headers) ||
        typeof source.body_text !== "string" ||
        typeof source.duration_ms !== "number"
    ) {
        return null;
    }

    const headers = source.headers
        .filter(
            (item): item is { key: string; value: string } =>
                !!item &&
                typeof item === "object" &&
                typeof (item as { key?: unknown }).key === "string" &&
                typeof (item as { value?: unknown }).value === "string"
        )
        .map((item) => ({ key: item.key, value: item.value }));

    return {
        status: source.status,
        headers,
        body_text: source.body_text,
        duration_ms: source.duration_ms,
    };
}

function sanitizeResponseEntry(entry: unknown): PersistedResponseEntry | null {
    if (!entry || typeof entry !== "object") return null;
    const source = entry as Record<string, unknown>;
    if (typeof source.statusText !== "string" || typeof source.updatedAt !== "string") {
        return null;
    }

    return {
        response: sanitizeHttpResponse(source.response),
        statusText: source.statusText,
        updatedAt: source.updatedAt,
    };
}

function readPersistedResponsesState(): PersistedResponsesState {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(RESPONSES_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") return {};

        const result: PersistedResponsesState = {};
        for (const [collectionId, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!value || typeof value !== "object") continue;
            const entries: PersistedResponsesCollection = {};
            for (const [requestId, entry] of Object.entries(value as Record<string, unknown>)) {
                const normalized = sanitizeResponseEntry(entry);
                if (!normalized) continue;
                entries[requestId] = normalized;
            }
            result[collectionId] = entries;
        }
        return result;
    } catch {
        return {};
    }
}

function writePersistedResponsesState(state: PersistedResponsesState) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(RESPONSES_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // ignore storage write failures
    }
}

export default function App() {
    const [collections, setCollections] = useState<CollectionMeta[]>([]);
    const [environments, setEnvironments] = useState<Environment[]>([]);
    const [activeEnvironmentId, setActiveEnvironmentId] = useState<string | null>(null);
    const [current, setCurrent] = useState<CollectionLoaded | null>(null);
    const [status, setStatus] = useState<string>("");
    const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
    const [openRequestIds, setOpenRequestIds] = useState<string[]>([]);
    const [resp, setResp] = useState<HttpResponseDto | null>(null);
    const [responsesByRequestId, setResponsesByRequestId] = useState<PersistedResponsesCollection>({});
    const [responseTab, setResponseTab] = useState<ResponseTabId>("body");
    const [draftsById, setDraftsById] = useState<Record<string, Request>>({});
    const [pending, setPending] = useState(false);
    const [editorText, setEditorText] = useState("");
    const [tab, setTab] = useState<"headers" | "query" | "body" | "json">("headers");
    const [contextMenu, setContextMenu] = useState<RequestContextMenu | null>(null);
    const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
    const [renameNameInput, setRenameNameInput] = useState("");
    const [renameError, setRenameError] = useState("");
    const [renameBusy, setRenameBusy] = useState(false);
    const [draggedRequestId, setDraggedRequestId] = useState<string | null>(null);
    const [dropIndicator, setDropIndicator] = useState<RequestDropIndicator | null>(null);
    const [draggedOpenTabRequestId, setDraggedOpenTabRequestId] = useState<string | null>(null);
    const [openTabDropIndicator, setOpenTabDropIndicator] = useState<RequestDropIndicator | null>(null);
    const [environmentsModalOpen, setEnvironmentsModalOpen] = useState(false);
    const [envSelectedId, setEnvSelectedId] = useState<string | null>(null);
    const [envDraftName, setEnvDraftName] = useState("");
    const [envDraftVars, setEnvDraftVars] = useState<KeyValue[]>([]);
    const [envBusy, setEnvBusy] = useState(false);
    const [envError, setEnvError] = useState("");
    const [collectionsModalOpen, setCollectionsModalOpen] = useState(false);
    const [collectionSelectedId, setCollectionSelectedId] = useState<string | null>(null);
    const [collectionDraftName, setCollectionDraftName] = useState("");
    const [collectionCreateName, setCollectionCreateName] = useState("");
    const [collectionBusy, setCollectionBusy] = useState(false);
    const [collectionError, setCollectionError] = useState("");
    const [deleteCollectionModal, setDeleteCollectionModal] = useState<DeleteCollectionModal | null>(null);
    const [closeDraftModal, setCloseDraftModal] = useState<CloseDraftModal | null>(null);
    const [closeDraftBusy, setCloseDraftBusy] = useState(false);
    const rawJsonEditorRef = useRef<{ getValue: () => string; setValue: (value: string) => void } | null>(null);
    const hydratedTabsCollectionIdRef = useRef<string | null>(null);

    async function clearCurrentCollectionView() {
        setCurrent(null);
        setSelectedRequestId(null);
        setOpenRequestIds([]);
        setResp(null);
        setDraggedRequestId(null);
        setDropIndicator(null);
        setDraggedOpenTabRequestId(null);
        setOpenTabDropIndicator(null);
        setResponsesByRequestId({});
        setDraftsById({});
        setCloseDraftModal(null);
        setCloseDraftBusy(false);
        hydratedTabsCollectionIdRef.current = null;
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

    const selectedSavedRequest = useMemo(() => {
        if (!current || !selectedRequestId) return null;
        return current.requests.find((r) => r.id === selectedRequestId) ?? null;
    }, [current, selectedRequestId]);

    const draft = useMemo(() => {
        if (!selectedRequestId) return null;
        return draftsById[selectedRequestId] ?? selectedSavedRequest;
    }, [draftsById, selectedRequestId, selectedSavedRequest]);

    const openTabs = useMemo(() => {
        if (!current) return [];

        const requestsById = new Map(current.requests.map((request) => [request.id, request]));
        return openRequestIds
            .map((requestId) => {
                const saved = requestsById.get(requestId);
                if (!saved) return null;
                const fromDraft = draftsById[requestId];
                const source = fromDraft ?? saved;

                return {
                    requestId,
                    method: source.method,
                    name: source.name,
                    hasLocalDraft: !!fromDraft,
                };
            })
            .filter((value): value is { requestId: string; method: Request["method"]; name: string; hasLocalDraft: boolean } => value !== null);
    }, [current, openRequestIds, draftsById]);

    const selectedResponseStatusText = useMemo(() => {
        if (!selectedRequestId) return status || "Idle";
        if (pending) return "Sending...";
        const persistedStatus = responsesByRequestId[selectedRequestId]?.statusText;
        return persistedStatus ?? (status || "No request sent yet.");
    }, [selectedRequestId, pending, responsesByRequestId, status]);

    const activeEnvironment = useMemo(
        () => environments.find((env) => env.id === activeEnvironmentId) ?? null,
        [environments, activeEnvironmentId]
    );

    const selectedCollectionForEdit = useMemo(
        () =>
            collectionSelectedId
                ? collections.find((entry) => entry.id === collectionSelectedId) ?? null
                : null,
        [collections, collectionSelectedId]
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

    const {
        beforeMountMonaco,
        editorOptions,
        bindBodyJsonEditor,
        bindBodyRawEditor,
    } = useMonacoVariableSupport({
        variableSuggestions,
        variableValues: activeEnvironmentValues,
    });

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
        if (!current) {
            setResponsesByRequestId({});
            return;
        }

        const persisted = readPersistedResponsesState();
        const source = persisted[current.meta.id] ?? {};
        const validRequestIds = new Set(current.requests.map((request) => request.id));
        const filtered = Object.fromEntries(
            Object.entries(source).filter(([requestId]) => validRequestIds.has(requestId))
        ) as PersistedResponsesCollection;

        setResponsesByRequestId(filtered);
    }, [current?.meta.id]);

    useEffect(() => {
        if (!current) return;
        const validRequestIds = new Set(current.requests.map((request) => request.id));
        setResponsesByRequestId((previous) => {
            const next = Object.fromEntries(
                Object.entries(previous).filter(([requestId]) => validRequestIds.has(requestId))
            ) as PersistedResponsesCollection;

            if (Object.keys(next).length === Object.keys(previous).length) {
                return previous;
            }
            return next;
        });
    }, [current?.requests]);

    useEffect(() => {
        if (!current) return;
        const persisted = readPersistedResponsesState();
        persisted[current.meta.id] = responsesByRequestId;
        writePersistedResponsesState(persisted);
    }, [current?.meta.id, responsesByRequestId]);

    useEffect(() => {
        if (!selectedRequestId) {
            setResp(null);
            return;
        }
        const entry = responsesByRequestId[selectedRequestId];
        setResp(entry?.response ?? null);
    }, [selectedRequestId, responsesByRequestId]);

    useEffect(() => {
        if (!current) {
            setOpenRequestIds([]);
            hydratedTabsCollectionIdRef.current = null;
            return;
        }

        const validIds = new Set(current.requests.map((request) => request.id));
        const persistedState = readPersistedTabsState();
        const persistedEntry = sanitizePersistedTabsEntry(persistedState[current.meta.id]);
        const restoredIds = persistedEntry.openRequestIds.filter((requestId) =>
            validIds.has(requestId)
        );

        setOpenRequestIds((previous) =>
            restoredIds.length > 0
                ? restoredIds
                : previous.filter((requestId) => validIds.has(requestId))
        );

        if (persistedEntry.activeRequestId && validIds.has(persistedEntry.activeRequestId)) {
            setSelectedRequestId(persistedEntry.activeRequestId);
        } else if (
            restoredIds.length > 0 &&
            (!selectedRequestId || !validIds.has(selectedRequestId))
        ) {
            setSelectedRequestId(restoredIds[0]);
        }

        hydratedTabsCollectionIdRef.current = current.meta.id;
    }, [current?.meta.id]);

    useEffect(() => {
        setDraggedRequestId(null);
        setDropIndicator(null);
        setDraggedOpenTabRequestId(null);
        setOpenTabDropIndicator(null);
    }, [current?.meta.id]);

    useEffect(() => {
        if (!current) return;
        const validIds = new Set(current.requests.map((request) => request.id));
        setOpenRequestIds((previous) => previous.filter((requestId) => validIds.has(requestId)));
    }, [current?.requests]);

    useEffect(() => {
        if (!selectedRequestId) return;
        setOpenRequestIds((previous) =>
            previous.includes(selectedRequestId) ? previous : [...previous, selectedRequestId]
        );
    }, [selectedRequestId]);

    useEffect(() => {
        if (!current || selectedRequestId) return;
        const validIds = new Set(current.requests.map((request) => request.id));
        const firstOpen = openRequestIds.find((requestId) => validIds.has(requestId)) ?? null;
        if (firstOpen) {
            setSelectedRequestId(firstOpen);
        }
    }, [current?.meta.id, current?.requests, selectedRequestId, openRequestIds]);

    useEffect(() => {
        if (!collectionsModalOpen) return;
        if (collectionSelectedId && collections.some((entry) => entry.id === collectionSelectedId)) {
            return;
        }

        const next =
            collections.find((entry) => entry.id === (current?.meta.id ?? "")) ?? collections[0] ?? null;
        setCollectionSelectedId(next?.id ?? null);
        setCollectionDraftName(next?.name ?? "");
    }, [collectionsModalOpen, collections, collectionSelectedId, current?.meta.id]);

    useEffect(() => {
        if (!current) return;
        if (hydratedTabsCollectionIdRef.current !== current.meta.id) return;

        const uniqueOpenRequestIds = Array.from(new Set(openRequestIds));
        const activeRequestId =
            selectedRequestId && uniqueOpenRequestIds.includes(selectedRequestId)
                ? selectedRequestId
                : uniqueOpenRequestIds[0] ?? null;

        const persistedState = readPersistedTabsState();
        persistedState[current.meta.id] = {
            openRequestIds: uniqueOpenRequestIds,
            activeRequestId,
        };
        writePersistedTabsState(persistedState);
    }, [current?.meta.id, openRequestIds, selectedRequestId]);

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
            setDraggedRequestId(null);
            setDropIndicator(null);
            setDraggedOpenTabRequestId(null);
            setOpenTabDropIndicator(null);
            if (!renameBusy) {
                setRenameTargetId(null);
                setRenameError("");
            }
            if (!envBusy) {
                setEnvironmentsModalOpen(false);
                setEnvError("");
            }
            if (!collectionBusy) {
                setCollectionsModalOpen(false);
                setCollectionError("");
                setDeleteCollectionModal(null);
            }
            if (!closeDraftBusy) {
                setCloseDraftModal(null);
            }
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [renameBusy, envBusy, collectionBusy, closeDraftBusy]);

    useEffect(() => {
        if (!draggedRequestId && !draggedOpenTabRequestId) return;

        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";

        function onMouseUp() {
            setDraggedRequestId(null);
            setDropIndicator(null);
            setDraggedOpenTabRequestId(null);
            setOpenTabDropIndicator(null);
        }

        window.addEventListener("mouseup", onMouseUp);
        return () => {
            window.removeEventListener("mouseup", onMouseUp);
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousUserSelect;
        };
    }, [draggedRequestId, draggedOpenTabRequestId]);

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

    const saveDraftById = useCallback(
        async (requestId: string): Promise<boolean> => {
            if (!current) return false;

            const draftToSave = draftsById[requestId];
            if (!draftToSave) return true;

            try {
                await invoke("update_request", {
                    collectionId: current.meta.id,
                    request: draftToSave,
                });

                setCurrent((previous) => {
                    if (!previous) return previous;
                    return {
                        ...previous,
                        requests: previous.requests.map((request) =>
                            request.id === requestId ? draftToSave : request
                        ),
                    };
                });

                setDraftsById((previous) => {
                    const next = { ...previous };
                    delete next[requestId];
                    return next;
                });

                setStatus("✅ Draft saved");
                return true;
            } catch (e) {
                setStatus(`❌ Save failed: ${String(e)}`);
                return false;
            }
        },
        [current, draftsById]
    );

    const discardDraftById = useCallback(
        async (requestId: string): Promise<boolean> => {
            if (!current) return false;
            if (!draftsById[requestId]) return true;

            try {
                await invoke("clear_draft", {
                    collectionId: current.meta.id,
                    requestId,
                });

                setDraftsById((previous) => {
                    const next = { ...previous };
                    delete next[requestId];
                    return next;
                });

                setStatus("✅ Draft discarded");
                return true;
            } catch (e) {
                setStatus(`❌ Discard failed: ${String(e)}`);
                return false;
            }
        },
        [current, draftsById]
    );

    const saveDraft = useCallback(async () => {
        if (!selectedRequestId) return;
        await saveDraftById(selectedRequestId);
    }, [selectedRequestId, saveDraftById]);

    const closeRequestTab = useCallback(
        (requestId: string) => {
            const index = openRequestIds.indexOf(requestId);
            if (index === -1) return;

            const remaining = openRequestIds.filter((id) => id !== requestId);
            setOpenRequestIds(remaining);
            if (draggedOpenTabRequestId === requestId) {
                setDraggedOpenTabRequestId(null);
                setOpenTabDropIndicator(null);
            }

            if (selectedRequestId === requestId) {
                const nextSelection = remaining[Math.min(index, remaining.length - 1)] ?? null;
                setSelectedRequestId(nextSelection);
            }
        },
        [openRequestIds, selectedRequestId, draggedOpenTabRequestId]
    );

    function requestCloseTab(requestId: string) {
        if (draftsById[requestId]) {
            setCloseDraftModal({ requestId });
            return;
        }

        closeRequestTab(requestId);
    }

    async function confirmCloseWithSave() {
        if (!closeDraftModal || closeDraftBusy) return;
        setCloseDraftBusy(true);

        const saved = await saveDraftById(closeDraftModal.requestId);
        if (saved) {
            closeRequestTab(closeDraftModal.requestId);
            setCloseDraftModal(null);
        }

        setCloseDraftBusy(false);
    }

    async function confirmCloseWithDiscard() {
        if (!closeDraftModal || closeDraftBusy) return;
        setCloseDraftBusy(true);

        const discarded = await discardDraftById(closeDraftModal.requestId);
        if (discarded) {
            closeRequestTab(closeDraftModal.requestId);
            setCloseDraftModal(null);
        }

        setCloseDraftBusy(false);
    }

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
            const statusText = `✅ ${r.status} in ${r.duration_ms}ms`;
            setResp(r);
            setStatus(statusText);
            setResponsesByRequestId((previous) => ({
                ...previous,
                [selectedRequestId]: {
                    response: r,
                    statusText,
                    updatedAt: new Date().toISOString(),
                },
            }));
        } catch (e: any) {
            const kind = e?.kind ?? "unknown";
            const msg = e?.message ?? String(e);
            const d = e?.duration_ms;
            const statusText = `❌ ${kind}: ${msg}${d != null ? ` (${d}ms)` : ""}`;
            setStatus(statusText);
            setResponsesByRequestId((previous) => ({
                ...previous,
                [selectedRequestId]: {
                    response: previous[selectedRequestId]?.response ?? null,
                    statusText,
                    updatedAt: new Date().toISOString(),
                },
            }));
        } finally {
            const p = await isPending(selectedRequestId).catch(() => false);
            setPending(p);
        }
    }

    async function cancel() {
        if (!selectedRequestId) return;

        try {
            await invoke("cancel_request", { requestId: selectedRequestId });
            const statusText = "⛔ Cancel requested";
            setStatus(statusText);
            setResponsesByRequestId((previous) => ({
                ...previous,
                [selectedRequestId]: {
                    response: previous[selectedRequestId]?.response ?? null,
                    statusText,
                    updatedAt: new Date().toISOString(),
                },
            }));
        } catch (e) {
            setStatus(`❌ Cancel failed: ${String(e)}`);
        } finally {
            const p = await isPending(selectedRequestId).catch(() => false);
            setPending(p);
        }
    }

    function setSelection(r: Request) {
        setSelectedRequestId(r.id);
    }

    async function reorderRequestsInCollection(
        sourceRequestId: string,
        targetRequestId: string,
        position: "before" | "after"
    ) {
        if (!current) return;
        if (targetRequestId === sourceRequestId) return;

        const currentOrder = current.requests.map((request) => request.id);
        if (!currentOrder.includes(targetRequestId) || !currentOrder.includes(sourceRequestId)) {
            return;
        }

        const withoutDragged = currentOrder.filter((id) => id !== sourceRequestId);
        const targetIndex = withoutDragged.indexOf(targetRequestId);
        if (targetIndex === -1) return;

        const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
        withoutDragged.splice(insertIndex, 0, sourceRequestId);
        const nextOrder = withoutDragged;

        const unchanged =
            nextOrder.length === currentOrder.length &&
            nextOrder.every((id, index) => id === currentOrder[index]);
        if (unchanged) return;

        const previousCurrent = current;
        const requestsById = new Map(previousCurrent.requests.map((request) => [request.id, request]));
        const nextRequests = nextOrder
            .map((id) => requestsById.get(id))
            .filter((request): request is Request => !!request);

        if (nextRequests.length !== nextOrder.length) {
            setStatus("❌ Reorder failed: inconsistent request set");
            return;
        }

        setCurrent((previous) => {
            if (!previous || previous.meta.id !== previousCurrent.meta.id) return previous;
            return {
                ...previous,
                meta: {
                    ...previous.meta,
                    request_order: nextOrder,
                },
                requests: nextRequests,
            };
        });

        try {
            await invoke("reorder_requests", {
                collectionId: previousCurrent.meta.id,
                requestOrder: nextOrder,
            });
            setStatus("✅ Request order updated");
        } catch (e) {
            setCurrent((previous) => {
                if (!previous || previous.meta.id !== previousCurrent.meta.id) return previous;
                return previousCurrent;
            });
            setStatus(`❌ Reorder failed: ${String(e)}`);
        }
    }

    function beginRequestDrag(
        e: React.MouseEvent<HTMLElement>,
        requestId: string
    ) {
        if (e.button !== 0) return;
        setDraggedRequestId(requestId);
        setDropIndicator(null);
    }

    function beginOpenTabDrag(
        e: React.MouseEvent<HTMLElement>,
        requestId: string
    ) {
        if (e.button !== 0) return;
        setDraggedOpenTabRequestId(requestId);
        setOpenTabDropIndicator(null);
    }

    function reorderOpenTabs(
        sourceRequestId: string,
        targetRequestId: string,
        position: "before" | "after"
    ) {
        if (sourceRequestId === targetRequestId) return;

        setOpenRequestIds((previous) => {
            if (!previous.includes(sourceRequestId) || !previous.includes(targetRequestId)) {
                return previous;
            }

            const withoutSource = previous.filter((id) => id !== sourceRequestId);
            const targetIndex = withoutSource.indexOf(targetRequestId);
            if (targetIndex === -1) return previous;

            const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
            const next = [...withoutSource];
            next.splice(insertIndex, 0, sourceRequestId);
            return next;
        });
    }

    function onDeleteRequest(requestId: string) {
        if (!current) return;

        if (draggedRequestId === requestId) {
            setDraggedRequestId(null);
            setDropIndicator(null);
        }
        if (draggedOpenTabRequestId === requestId) {
            setDraggedOpenTabRequestId(null);
            setOpenTabDropIndicator(null);
        }

        setDraftsById((prev) => {
            const next = { ...prev };
            delete next[requestId];
            return next;
        });
        setOpenRequestIds((previous) => previous.filter((id) => id !== requestId));
        setResponsesByRequestId((previous) => {
            const next = { ...previous };
            delete next[requestId];
            return next;
        });
        setCloseDraftModal((previous) =>
            previous?.requestId === requestId ? null : previous
        );

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

    function openCollectionsModal() {
        const selected =
            collections.find((collection) => collection.id === (current?.meta.id ?? "")) ??
            collections[0] ??
            null;
        setCollectionSelectedId(selected?.id ?? null);
        setCollectionDraftName(selected?.name ?? "");
        setCollectionCreateName("");
        setCollectionError("");
        setDeleteCollectionModal(null);
        setCollectionsModalOpen(true);
    }

    function closeCollectionsModal() {
        if (collectionBusy) return;
        setCollectionsModalOpen(false);
        setCollectionError("");
        setDeleteCollectionModal(null);
    }

    function pickCollectionForEdit(collectionId: string) {
        const collection = collections.find((entry) => entry.id === collectionId);
        if (!collection) return;
        setCollectionSelectedId(collection.id);
        setCollectionDraftName(collection.name);
        setCollectionError("");
        setDeleteCollectionModal(null);
    }

    async function onCreateCollection() {
        if (collectionBusy) return;
        const name = collectionCreateName.trim();
        if (!name) {
            setCollectionError("Collection name cannot be empty.");
            return;
        }

        setCollectionBusy(true);
        setCollectionError("");
        try {
            const created = await invoke<CollectionMeta>("create_collection", { name });
            await invoke("set_active_collection", { collectionId: created.id });
            await reloadCollectionsAndRestoreActive(created.id);
            setCollectionSelectedId(created.id);
            setCollectionDraftName(created.name);
            setCollectionCreateName("");
            setStatus(`✅ Collection created: ${created.name}`);
        } catch (e) {
            setCollectionError(`Create failed: ${String(e)}`);
        } finally {
            setCollectionBusy(false);
        }
    }

    async function onSaveCollection() {
        if (!collectionSelectedId || collectionBusy) return;
        const name = collectionDraftName.trim();
        if (!name) {
            setCollectionError("Collection name cannot be empty.");
            return;
        }

        setCollectionBusy(true);
        setCollectionError("");
        try {
            await invoke("rename_collection", {
                collectionId: collectionSelectedId,
                newName: name,
            });
            await reloadCollectionsAndRestoreActive(current?.meta.id ?? collectionSelectedId);
            setStatus("✅ Collection saved");
        } catch (e) {
            setCollectionError(`Save failed: ${String(e)}`);
        } finally {
            setCollectionBusy(false);
        }
    }

    function requestDeleteSelectedCollection() {
        if (!collectionSelectedId || collectionBusy) return;
        const selected = collections.find((entry) => entry.id === collectionSelectedId);
        if (!selected) return;
        setDeleteCollectionModal({ id: selected.id, name: selected.name });
    }

    async function onDeleteCollection() {
        if (!deleteCollectionModal || collectionBusy) return;

        setCollectionBusy(true);
        setCollectionError("");
        try {
            const deletingId = deleteCollectionModal.id;
            const remaining = collections.filter((entry) => entry.id !== deletingId);
            const nextActive =
                (current?.meta.id ?? null) === deletingId
                    ? (remaining[0]?.id ?? null)
                    : (current?.meta.id ?? null);

            await invoke("delete_collection", { collectionId: deletingId });
            await invoke("set_active_collection", { collectionId: nextActive });
            await reloadCollectionsAndRestoreActive(nextActive);

            const nextSelected =
                remaining.find((entry) => entry.id === nextActive) ?? remaining[0] ?? null;
            setCollectionSelectedId(nextSelected?.id ?? null);
            setCollectionDraftName(nextSelected?.name ?? "");
            setDeleteCollectionModal(null);
            setStatus("✅ Collection deleted");
        } catch (e) {
            setCollectionError(`Delete failed: ${String(e)}`);
        } finally {
            setCollectionBusy(false);
        }
    }

    async function onSetActiveCollectionFromModal() {
        if (!collectionSelectedId || collectionBusy) return;

        setCollectionBusy(true);
        setCollectionError("");
        try {
            await invoke("set_active_collection", { collectionId: collectionSelectedId });
            await loadCollection(
                collectionSelectedId,
                null,
                setCurrent,
                setSelectedRequestId,
                setResp,
                setStatus
            );
            setStatus("✅ Collection selected");
        } catch (e) {
            setCollectionError(`Set active failed: ${String(e)}`);
        } finally {
            setCollectionBusy(false);
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
                onManageCollections={openCollectionsModal}
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
                    {/*<div>*/}
                    {/*    <h3>Collections</h3>*/}

                    {/*    <button*/}
                    {/*        style={{ ...buttonStyle(false), width: "100%", marginBottom: 8 }}*/}
                    {/*        onClick={async () => {*/}
                    {/*            await initDefault(setStatus, setCollections);*/}
                    {/*            await reloadCollectionsAndRestoreActive();*/}
                    {/*        }}*/}
                    {/*    >*/}
                    {/*        Init default*/}
                    {/*    </button>*/}
                    {/*    <button*/}
                    {/*        style={{ ...buttonStyle(false), width: "100%", marginBottom: 8 }}*/}
                    {/*        onClick={async () => {*/}
                    {/*            await refreshCollections(setCollections, setStatus);*/}
                    {/*            await reloadCollectionsAndRestoreActive();*/}
                    {/*        }}*/}
                    {/*    >*/}
                    {/*        Refresh*/}
                    {/*    </button>*/}
                    {/*    <button*/}
                    {/*        style={{ ...buttonStyle(false), width: "100%", marginBottom: 8 }}*/}
                    {/*        onClick={async () => {*/}
                    {/*            await overwriteDefault(setStatus, setCollections);*/}
                    {/*            await reloadCollectionsAndRestoreActive();*/}
                    {/*        }}*/}
                    {/*    >*/}
                    {/*        Overwrite default*/}
                    {/*    </button>*/}
                    {/*    <button*/}
                    {/*        style={{ ...buttonStyle(false), width: "100%" }}*/}
                    {/*        onClick={() => invoke("open_app_data_dir")}*/}
                    {/*    >*/}
                    {/*        Open data folder*/}
                    {/*    </button>*/}
                    {/*</div>*/}

                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            minHeight: 0,
                            flex: 1,
                            overflow: "hidden",
                        }}
                    >
                        <h3 style={{ marginTop: 16, marginBottom: 8, flexShrink: 0 }}>Saved Requests</h3>

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
                            {current && current.requests.length > 0 && (
                                <div
                                    onMouseMove={() => {
                                        const firstRequestId = current.requests[0].id;
                                        if (!draggedRequestId || draggedRequestId === firstRequestId) return;
                                        setDropIndicator({
                                            requestId: firstRequestId,
                                            position: "before",
                                        });
                                    }}
                                    onMouseUp={() => {
                                        const firstRequestId = current.requests[0].id;
                                        if (!draggedRequestId || draggedRequestId === firstRequestId) return;
                                        setDropIndicator(null);
                                        setDraggedRequestId(null);
                                        void reorderRequestsInCollection(
                                            draggedRequestId,
                                            firstRequestId,
                                            "before"
                                        );
                                    }}
                                    style={listEdgeDropStyle(
                                        !!current.requests[0] &&
                                            dropIndicator?.requestId === current.requests[0].id &&
                                            dropIndicator.position === "before"
                                    )}
                                >
                                    {dropIndicator?.requestId === current.requests[0].id &&
                                        dropIndicator.position === "before" && (
                                            <span style={edgeDropLabelStyle()}>Drop at top</span>
                                        )}
                                </div>
                            )}

                            {current &&
                                current.requests.map((r) => {
                                    const hasLocalDraft = !!draftsById[r.id];
                                    const showDropBefore =
                                        dropIndicator?.requestId === r.id &&
                                        dropIndicator.position === "before";
                                    const showDropAfter =
                                        dropIndicator?.requestId === r.id &&
                                        dropIndicator.position === "after";

                                    return (
                                        <div
                                            key={r.id}
                                            onMouseMove={(e) => {
                                                if (!draggedRequestId || draggedRequestId === r.id) return;
                                                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                                const position =
                                                    e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                                                setDropIndicator((previous) =>
                                                    previous?.requestId === r.id && previous.position === position
                                                        ? previous
                                                        : { requestId: r.id, position }
                                                );
                                            }}
                                            onMouseUp={(e) => {
                                                if (!draggedRequestId || draggedRequestId === r.id) return;
                                                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                                const position =
                                                    e.clientY < rect.top + rect.height / 2 ? "before" : "after";

                                                setDropIndicator(null);
                                                setDraggedRequestId(null);
                                                void reorderRequestsInCollection(draggedRequestId, r.id, position);
                                            }}
                                            style={requestDropRowStyle(showDropBefore, showDropAfter)}
                                        >
                                            {showDropBefore && <div style={dropMarkerStyle("before")} />}
                                            <button
                                                onMouseDown={(e) => beginRequestDrag(e, r.id)}
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
                                                    ...requestListItemStyle(
                                                        r.id === selectedRequestId,
                                                        hasLocalDraft
                                                    ),
                                                    width: "100%",
                                                    textAlign: "left",
                                                    flexShrink: 0,
                                                    cursor: draggedRequestId === r.id ? "grabbing" : "grab",
                                                    userSelect: "none",
                                                }}
                                            >
                                                {r.method.toUpperCase()} {r.name} {hasLocalDraft ? "●" : ""}
                                            </button>
                                            {showDropAfter && <div style={dropMarkerStyle("after")} />}
                                        </div>
                                    );
                                })}

                            {current && current.requests.length > 0 && (
                                <div
                                    onMouseMove={() => {
                                        const lastRequestId = current.requests[current.requests.length - 1].id;
                                        if (!draggedRequestId || draggedRequestId === lastRequestId) return;
                                        setDropIndicator({
                                            requestId: lastRequestId,
                                            position: "after",
                                        });
                                    }}
                                    onMouseUp={() => {
                                        const lastRequestId = current.requests[current.requests.length - 1].id;
                                        if (!draggedRequestId || draggedRequestId === lastRequestId) return;
                                        setDropIndicator(null);
                                        setDraggedRequestId(null);
                                        void reorderRequestsInCollection(
                                            draggedRequestId,
                                            lastRequestId,
                                            "after"
                                        );
                                    }}
                                    style={listEdgeDropStyle(
                                        dropIndicator?.requestId === current.requests[current.requests.length - 1].id &&
                                            dropIndicator.position === "after"
                                    )}
                                >
                                    {dropIndicator?.requestId === current.requests[current.requests.length - 1].id &&
                                        dropIndicator.position === "after" && (
                                            <span style={edgeDropLabelStyle()}>Drop at bottom</span>
                                        )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Main */}
                <div
                    style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap :10,
                        minWidth: 0,
                        minHeight: 0,
                        overflow: "hidden",
                    }}
                >
                    {current && openTabs.length > 0 && (
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                overflowX: "auto",
                                paddingBottom: 4,
                                flexShrink: 0,
                            }}
                        >
                            <div
                                onMouseMove={() => {
                                    const firstTabId = openTabs[0]?.requestId;
                                    if (!firstTabId) return;
                                    if (!draggedOpenTabRequestId || draggedOpenTabRequestId === firstTabId) return;
                                    setOpenTabDropIndicator({ requestId: firstTabId, position: "before" });
                                }}
                                onMouseUp={() => {
                                    const firstTabId = openTabs[0]?.requestId;
                                    if (!firstTabId) return;
                                    if (!draggedOpenTabRequestId || draggedOpenTabRequestId === firstTabId) return;
                                    setOpenTabDropIndicator(null);
                                    setDraggedOpenTabRequestId(null);
                                    reorderOpenTabs(draggedOpenTabRequestId, firstTabId, "before");
                                }}
                                style={tabEdgeDropStyle(
                                    !!openTabs[0] &&
                                        openTabDropIndicator?.requestId === openTabs[0].requestId &&
                                        openTabDropIndicator.position === "before"
                                )}
                            >
                                {!!openTabs[0] &&
                                    openTabDropIndicator?.requestId === openTabs[0].requestId &&
                                    openTabDropIndicator.position === "before" && (
                                        <span style={tabEdgeDropLabelStyle()}>Drop first</span>
                                    )}
                            </div>

                            {openTabs.map((openTab) => {
                                const active = openTab.requestId === selectedRequestId;
                                const showDropBefore =
                                    openTabDropIndicator?.requestId === openTab.requestId &&
                                    openTabDropIndicator.position === "before";
                                const showDropAfter =
                                    openTabDropIndicator?.requestId === openTab.requestId &&
                                    openTabDropIndicator.position === "after";
                                return (
                                    <div
                                        key={openTab.requestId}
                                        onMouseMove={(e) => {
                                            if (!draggedOpenTabRequestId || draggedOpenTabRequestId === openTab.requestId) {
                                                return;
                                            }
                                            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                            const position =
                                                e.clientX < rect.left + rect.width / 2 ? "before" : "after";
                                            setOpenTabDropIndicator((previous) =>
                                                previous?.requestId === openTab.requestId &&
                                                previous.position === position
                                                    ? previous
                                                    : { requestId: openTab.requestId, position }
                                            );
                                        }}
                                        onMouseUp={(e) => {
                                            if (!draggedOpenTabRequestId || draggedOpenTabRequestId === openTab.requestId) {
                                                return;
                                            }
                                            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                            const position =
                                                e.clientX < rect.left + rect.width / 2 ? "before" : "after";
                                            setOpenTabDropIndicator(null);
                                            setDraggedOpenTabRequestId(null);
                                            reorderOpenTabs(draggedOpenTabRequestId, openTab.requestId, position);
                                        }}
                                        style={openTabDropWrapStyle(showDropBefore, showDropAfter)}
                                    >
                                        {showDropBefore && <div style={openTabDropMarkerStyle("before")} />}
                                        <div style={draftTabContainerStyle(active)}>
                                        <button
                                            onMouseDown={(e) => beginOpenTabDrag(e, openTab.requestId)}
                                            onClick={() => {
                                                setSelectedRequestId(openTab.requestId);
                                            }}
                                            style={{
                                                ...draftTabButtonStyle(active),
                                                cursor:
                                                    draggedOpenTabRequestId === openTab.requestId
                                                        ? "grabbing"
                                                        : "grab",
                                                userSelect: "none",
                                            }}
                                        >
                                            {openTab.method.toUpperCase()} {openTab.name}
                                            {openTab.hasLocalDraft ? " ●" : ""}
                                        </button>
                                        <button
                                            onClick={() =>
                                                requestCloseTab(openTab.requestId)
                                            }
                                            style={draftTabCloseButtonStyle()}
                                            title="Close draft tab"
                                        >
                                            ×
                                        </button>
                                        </div>
                                        {showDropAfter && <div style={openTabDropMarkerStyle("after")} />}
                                    </div>
                                );
                            })}

                            <div
                                onMouseMove={() => {
                                    const lastTabId = openTabs[openTabs.length - 1]?.requestId;
                                    if (!lastTabId) return;
                                    if (!draggedOpenTabRequestId || draggedOpenTabRequestId === lastTabId) return;
                                    setOpenTabDropIndicator({ requestId: lastTabId, position: "after" });
                                }}
                                onMouseUp={() => {
                                    const lastTabId = openTabs[openTabs.length - 1]?.requestId;
                                    if (!lastTabId) return;
                                    if (!draggedOpenTabRequestId || draggedOpenTabRequestId === lastTabId) return;
                                    setOpenTabDropIndicator(null);
                                    setDraggedOpenTabRequestId(null);
                                    reorderOpenTabs(draggedOpenTabRequestId, lastTabId, "after");
                                }}
                                style={tabEdgeDropStyle(
                                    !!openTabs[openTabs.length - 1] &&
                                        openTabDropIndicator?.requestId === openTabs[openTabs.length - 1].requestId &&
                                        openTabDropIndicator.position === "after"
                                )}
                            >
                                {!!openTabs[openTabs.length - 1] &&
                                    openTabDropIndicator?.requestId === openTabs[openTabs.length - 1].requestId &&
                                    openTabDropIndicator.position === "after" && (
                                        <span style={tabEdgeDropLabelStyle()}>Drop last</span>
                                    )}
                            </div>
                        </div>
                    )}

                    {current && draft && (
                        <>
                            {/*<div*/}
                            {/*    style={{*/}
                            {/*        display: "flex",*/}
                            {/*        justifyContent: "space-between",*/}
                            {/*        alignItems: "center",*/}
                            {/*        gap: 8,*/}
                            {/*        marginTop: 12,*/}
                            {/*        flexShrink: 0,*/}
                            {/*    }}*/}
                            {/*>*/}
                            {/*    <h3>Editor</h3>*/}
                            {/*    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>*/}
                            {/*        {isDirty && <span style={{ color: "var(--pg-warning)" }}>● Unsaved</span>}*/}
                            {/*        {selectedRequestId ? (pending ? "⏳ pending" : "✅ idle") : ""}*/}
                            {/*    </div>*/}
                            {/*</div>*/}

                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
                                <select
                                    value={draft.method}
                                    onChange={(e) =>
                                        updateDraft({ method: e.target.value as Request["method"] })
                                    }
                                    style={selectStyle()}
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

                                <button
                                    onClick={sendSelected}
                                    disabled={!selectedRequestId || pending}
                                    style={primaryButtonStyle(!selectedRequestId || pending)}
                                >
                                    Send
                                </button>

                                <button
                                    onClick={cancel}
                                    disabled={!selectedRequestId || !pending}
                                    style={buttonStyle(!selectedRequestId || !pending)}
                                >
                                    Cancel
                                </button>
                            </div>

                            <div style={{ display: "flex", gap: 8, marginTop: 12, flexShrink: 0 }}>
                                <button
                                    onClick={() => setTab("headers")}
                                    style={editorTabStyle(tab === "headers")}
                                >
                                    Headers
                                </button>
                                <button
                                    onClick={() => setTab("query")}
                                    style={editorTabStyle(tab === "query")}
                                >
                                    Query
                                </button>
                                <button
                                    onClick={() => setTab("body")}
                                    style={editorTabStyle(tab === "body")}
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
                                <RequestBodyEditor
                                    draft={draft}
                                    selectedRequestId={selectedRequestId}
                                    beforeMountMonaco={beforeMountMonaco}
                                    editorOptions={editorOptions}
                                    onPatchDraft={updateDraft}
                                    onSetFullDraft={setFullDraft}
                                    onMountBodyJsonEditor={bindBodyJsonEditor}
                                    onMountBodyRawEditor={bindBodyRawEditor}
                                    resolveVariableStatus={resolveVariableStatus}
                                    resolveVariableValue={resolveVariableValue}
                                    variableSuggestions={variableSuggestions}
                                    editorPanelStyle={editorPanelStyle}
                                />
                            )}

                            {tab === "json" && (
                                <>
                                    <div style={editorPanelStyle("52vh", 360)}>
                                        <Editor
                                            key={`request-json-${selectedRequestId ?? "none"}`}
                                            height="100%"
                                            language="json"
                                            path={`/postguerl-dev/${selectedRequestId ?? "none"}.json`}
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
                                    <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                                        Dev view: request object (read-only)
                                    </div>
                                </>
                            )}

                            <ResponsePanel
                                response={resp}
                                statusText={selectedResponseStatusText}
                                activeTab={responseTab}
                                onTabChange={setResponseTab}
                            />
                        </>
                    )}

                    {current && !draft && (
                        <div
                            style={{
                                marginTop: 16,
                                padding: 16,
                                borderRadius: 12,
                                border: "1px solid var(--pg-border)",
                                background: "var(--pg-surface-soft)",
                                color: "var(--pg-text-dim)",
                            }}
                        >
                            No request is open. Select a saved request from the left panel.
                        </div>
                    )}

                    {!current && (
                        <>
                            <h3 style={{ marginTop: 16 }}>Loaded collection</h3>
                            <pre style={{ background: "var(--pg-surface-1)", color: "var(--pg-text-dim)", padding: 12 }}>None</pre>
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
                            border: "1px solid var(--pg-border)",
                            background: "var(--pg-surface-1)",
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
                                color: "var(--pg-danger)",
                                borderColor: "var(--pg-danger-dark)",
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
                            border: "1px solid var(--pg-border)",
                            borderRadius: 12,
                            background: "var(--pg-surface-1)",
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                        }}
                    >
                        <h3 style={{ margin: 0 }}>Rename request</h3>

                        <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                            Request id:{" "}
                            <code style={{ color: "var(--pg-text)" }}>
                                {renameTargetId}
                            </code>
                        </div>

                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>Request name</span>
                            <input
                                value={renameNameInput}
                                onChange={(e) => setRenameNameInput(e.target.value)}
                                disabled={renameBusy}
                            />
                        </label>

                        {renameError && <div style={{ color: "var(--pg-danger)", fontSize: 13 }}>{renameError}</div>}

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

            {closeDraftModal && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 1350,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                    }}
                    onMouseDown={() => {
                        if (!closeDraftBusy) setCloseDraftModal(null);
                    }}
                >
                    <div
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 480,
                            border: "1px solid var(--pg-border)",
                            borderRadius: 12,
                            background: "var(--pg-surface-1)",
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            gap: 14,
                        }}
                    >
                        <h3 style={{ margin: 0 }}>Unsaved draft</h3>
                        <div style={{ fontSize: 13, color: "var(--pg-text-dim)", lineHeight: 1.5 }}>
                            This tab contains unsaved changes. Save before closing, or discard this draft.
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button
                                onClick={() => setCloseDraftModal(null)}
                                disabled={closeDraftBusy}
                                style={buttonStyle(closeDraftBusy)}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => void confirmCloseWithDiscard()}
                                disabled={closeDraftBusy}
                                style={dangerButtonStyle(closeDraftBusy)}
                            >
                                {closeDraftBusy ? "Discarding..." : "Discard"}
                            </button>
                            <button
                                onClick={() => void confirmCloseWithSave()}
                                disabled={closeDraftBusy}
                                style={primaryButtonStyle(closeDraftBusy)}
                            >
                                {closeDraftBusy ? "Saving..." : "Save & Close"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <CollectionsModal
                open={collectionsModalOpen}
                busy={collectionBusy}
                error={collectionError}
                collections={collections}
                activeCollectionId={current?.meta.id ?? null}
                selectedCollectionId={collectionSelectedId}
                selectedCollection={selectedCollectionForEdit}
                createName={collectionCreateName}
                draftName={collectionDraftName}
                deleteTarget={deleteCollectionModal}
                onClose={closeCollectionsModal}
                onCreateNameChange={setCollectionCreateName}
                onDraftNameChange={setCollectionDraftName}
                onCreate={() => void onCreateCollection()}
                onPickCollection={pickCollectionForEdit}
                onSetActive={() => void onSetActiveCollectionFromModal()}
                onRequestDelete={requestDeleteSelectedCollection}
                onSave={() => void onSaveCollection()}
                onCancelDelete={() => setDeleteCollectionModal(null)}
                onConfirmDelete={() => void onDeleteCollection()}
            />

            <EnvironmentsModal
                open={environmentsModalOpen}
                busy={envBusy}
                error={envError}
                environments={environments}
                activeEnvironmentId={activeEnvironmentId}
                selectedEnvironmentId={envSelectedId}
                draftName={envDraftName}
                draftVars={envDraftVars}
                onClose={closeEnvironmentsModal}
                onCreate={() => void onCreateEnvironment()}
                onDuplicate={() => void onDuplicateEnvironment()}
                onDelete={() => void onDeleteEnvironment()}
                onPickEnvironment={pickEnvironmentForEdit}
                onDraftNameChange={setEnvDraftName}
                onDraftVarsChange={setEnvDraftVars}
                onSetActive={() => {
                    if (!envSelectedId) return;
                    void onSelectEnvironment(envSelectedId);
                }}
                onSave={() => void onSaveEnvironment()}
            />
        </>
    );
}

function requestListItemStyle(active: boolean, hasLocalDraft: boolean): React.CSSProperties {
    return {
        ...buttonStyle(false),
        borderColor: active
            ? "var(--pg-primary)"
            : hasLocalDraft
                ? "var(--pg-primary-soft)"
                : "var(--pg-border)",
        background: active ? "var(--pg-primary)" : "var(--pg-surface-gradient)",
        boxShadow: active ? "0 12px 24px rgba(var(--pg-primary-rgb), 0.35)" : "none",
        color: active ? "var(--pg-primary-ink)" : "var(--pg-text)",
        fontWeight: active ? 700 : 500,
    };
}

function requestDropRowStyle(
    dropBefore: boolean,
    dropAfter: boolean
): React.CSSProperties {
    return {
        position: "relative",
        display: "flex",
        alignItems: "stretch",
        borderRadius: 10,
        paddingTop: 1,
        paddingBottom: 1,
        background:
            dropBefore || dropAfter ? "rgba(var(--pg-primary-rgb), 0.08)" : "transparent",
    };
}

function listEdgeDropStyle(active: boolean): React.CSSProperties {
    return {
        height: active ? 34 : 12,
        borderRadius: 10,
        border: active ? "1px dashed var(--pg-primary)" : "1px dashed transparent",
        color: "var(--pg-primary-ink)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        marginBottom: 2,
        marginTop: 2,
        transition: "all 120ms ease-out",
    };
}

function edgeDropLabelStyle(): React.CSSProperties {
    return {
        background: "var(--pg-primary)",
        color: "var(--pg-primary-ink)",
        borderRadius: 999,
        padding: "4px 10px",
        lineHeight: 1.4,
    };
}

function dropMarkerStyle(position: "before" | "after"): React.CSSProperties {
    return {
        position: "absolute",
        left: 0,
        right: 0,
        top: position === "before" ? -3 : undefined,
        bottom: position === "after" ? -3 : undefined,
        height: 3,
        borderRadius: 999,
        background: "var(--pg-primary)",
        pointerEvents: "none",
        boxShadow: "0 0 0 1px rgba(var(--pg-primary-rgb), 0.35)",
    };
}

function editorTabStyle(active: boolean): React.CSSProperties {
    return {
        ...buttonStyle(false),
        borderColor: active ? "var(--pg-primary)" : "var(--pg-border)",
        background: active ? "var(--pg-primary)" : "var(--pg-surface-gradient)",
        color: active ? "var(--pg-primary-ink)" : "var(--pg-text)",
    };
}

function draftTabContainerStyle(active: boolean): React.CSSProperties {
    return {
        display: "flex",
        alignItems: "center",
        borderRadius: 10,
        overflow: "hidden",
        border: active ? "1px solid var(--pg-primary)" : "1px solid var(--pg-border)",
        background: active ? "var(--pg-primary)" : "var(--pg-surface-gradient)",
        minWidth: 200,
        boxShadow: active ? "0 12px 24px rgba(var(--pg-primary-rgb), 0.35)" : "none",
    };
}

function draftTabButtonStyle(active: boolean): React.CSSProperties {
    return {
        border: "none",
        background: "transparent",
        color: active ? "var(--pg-primary-ink)" : "var(--pg-text-dim)",
        padding: "8px 12px",
        fontWeight: 600,
        textAlign: "left",
        flex: 1,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        boxShadow: "none",
        borderRadius: 0,
    };
}

function draftTabCloseButtonStyle(): React.CSSProperties {
    return {
        width: 34,
        height: 34,
        border: "none",
        borderLeft: "1px solid rgba(var(--pg-primary-rgb), 0.3)",
        background: "transparent",
        color: "var(--pg-text-dim)",
        padding: 0,
        borderRadius: 0,
        boxShadow: "none",
        lineHeight: 1,
        fontSize: 16,
    };
}

function openTabDropWrapStyle(dropBefore: boolean, dropAfter: boolean): React.CSSProperties {
    return {
        position: "relative",
        display: "flex",
        alignItems: "stretch",
        borderRadius: 10,
        paddingLeft: 2,
        paddingRight: 2,
        background: dropBefore || dropAfter ? "rgba(var(--pg-primary-rgb), 0.08)" : "transparent",
        flexShrink: 0,
    };
}

function openTabDropMarkerStyle(position: "before" | "after"): React.CSSProperties {
    return {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: position === "before" ? -3 : undefined,
        right: position === "after" ? -3 : undefined,
        width: 3,
        borderRadius: 999,
        background: "var(--pg-primary)",
        pointerEvents: "none",
        boxShadow: "0 0 0 1px rgba(var(--pg-primary-rgb), 0.35)",
    };
}

function tabEdgeDropStyle(active: boolean): React.CSSProperties {
    return {
        width: active ? 88 : 16,
        height: 34,
        borderRadius: 10,
        border: active ? "1px dashed var(--pg-primary)" : "1px dashed transparent",
        color: "var(--pg-primary-ink)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        flexShrink: 0,
        transition: "all 120ms ease-out",
        background: active ? "rgba(var(--pg-primary-rgb), 0.08)" : "transparent",
    };
}

function tabEdgeDropLabelStyle(): React.CSSProperties {
    return {
        background: "var(--pg-primary)",
        color: "var(--pg-primary-ink)",
        borderRadius: 999,
        padding: "4px 10px",
        lineHeight: 1.2,
        whiteSpace: "nowrap",
    };
}

function editorPanelStyle(height: number | string, minHeight = 220): React.CSSProperties {
    return {
        height,
        minHeight,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid var(--pg-border)",
        boxShadow: "inset 0 0 0 1px var(--pg-surface-0), 0 14px 28px rgba(2, 6, 23, 0.35)",
        background: "var(--pg-editor-deep)",
    };
}
