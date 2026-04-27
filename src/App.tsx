import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPending } from "./helpers/HttpHelper";
import Editor from "@monaco-editor/react";
import {
    devCreate,
    devDelete,
    devDuplicate,
    devRename,
    loadCollection,
} from "./helpers/CollectionsHelper.ts";
import {
    buildSidebarRows,
    folderOptions,
    requestsInTreeOrder,
    type FolderOption,
    type SidebarTreeRow,
} from "./helpers/CollectionTree.ts";
import KeyValueTable from "./KeyValueTable.tsx";
import TopBar from "./TopBar.tsx";
import VariableInput, { type VariableStatus } from "./VariableInput.tsx";
import RequestBodyEditor from "./components/RequestBodyEditor.tsx";
import RequestScriptsEditor from "./components/RequestScriptsEditor.tsx";
import CollectionsModal from "./components/CollectionsModal.tsx";
import EnvironmentsModal from "./components/EnvironmentsModal.tsx";
import ConfirmationModal from "./components/ConfirmationModal.tsx";
import NoCollectionsModal from "./components/NoCollectionsModal.tsx";
import ResponsePanel, { type ResponseTabId } from "./components/ResponsePanel.tsx";
import CollectionRunnerModal from "./components/CollectionRunnerModal.tsx";
import { useMonacoVariableSupport } from "./hooks/useMonacoVariableSupport.ts";
import {
    copyTextToClipboard,
    copyRequestToClipboard,
    isBifrostClipboardRequestPayload,
    parseBifrostClipboardPayload,
    readRequestFromClipboard,
    type BifrostClipboardRequestPayloadV1,
} from "./helpers/ClipboardRequestTransfer.ts";
import { buildCurlCommand } from "./helpers/CurlCommand.ts";
import {
    getRunnerSelectedRequestsForCollection,
    loadRunnerSelectedRequests,
    saveRunnerSelectedRequests,
    setRunnerSelectedRequestsForCollection,
    type RunnerSelectedRequestsState,
} from "./helpers/RunnerSelectionStorage.ts";
import {
    buttonStyle,
    dangerButtonStyle,
    primaryButtonStyle,
    selectStyle,
} from "./helpers/UiStyles.ts";
import { buildRunnerExecutionPlan } from "./runner/plan.ts";
import {
    createQueuedExecutionResult,
    parseRunnerHttpError,
    toResponseSnapshot,
} from "./runner/mappers.ts";
import { summarizeRunnerExecutions } from "./runner/stats.ts";
import { readRunnerRunForCollection, writeRunnerRunForCollection } from "./runner/storage.ts";
import {
    runPostResponseScript,
    runPreRequestScript,
    type ScriptEnvironmentMutation,
    type ScriptTestResult,
} from "./helpers/RequestScriptsRuntime.ts";
import type {
    RunnerExecutionResult,
    RunnerIterationMode,
    RunnerRun,
} from "./runner/types.ts";
import type {
    CollectionLoaded,
    CollectionMeta,
    Environment,
    HttpResponseDto,
    ImportPostmanResult,
    ImportPortableResult,
    KeyValue,
    RequestAuth,
    Request,
    RequestScripts,
} from "./types.ts";
import {
    checkForUpdate,
    downloadAndInstallPendingUpdate,
    restartAfterUpdate,
} from "./helpers/TauriUpdaterHelper.ts";
import {
    notifyDismiss,
    notifyError,
    notifyInfo,
    notifyLoading,
    notifySuccess,
} from "./helpers/Toast.tsx";

type SidebarContextMenu = {
    x: number;
    y: number;
    row: SidebarTreeRow;
};

type RootAddMenu = {
    x: number;
    y: number;
};

type CloseDraftModal = {
    requestId: string;
};

type RequestDropIndicator = {
    nodeId: string;
    position: "before" | "after" | "inside";
};

type OpenTabDropIndicator = {
    requestId: string;
    position: "before" | "after";
};

type MoveNodeModal = {
    nodeId: string;
    currentParentFolderId: string | null;
    title: string;
};

type CreateRequestModal = {
    parentFolderId: string | null;
};

type DeleteCollectionModal = {
    id: string;
    name: string;
};

type DeleteEnvironmentModal = {
    id: string;
    name: string;
};

type DeleteFolderModal = {
    id: string;
    name: string;
};

type DeleteRequestModal = {
    id: string;
    name: string;
};

type ClipboardRequestImportModal = {
    payload: BifrostClipboardRequestPayloadV1;
    targetFolderId: string | null;
    targetFolderLabel: string | null;
};

type UpdateRestartModal = {
    version: string;
};

type UpdateDownloadModal = {
    version: string;
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
type PersistedCollapsedFoldersState = Record<string, string[]>;

type RequestScriptExecutionReport = {
    preRequestError: string | null;
    postResponseError: string | null;
    tests: ScriptTestResult[];
};

const OPEN_TABS_STORAGE_KEY = "bifrost:open-tabs:v1";
const RESPONSES_STORAGE_KEY = "bifrost:last-responses:v1";
const SAVED_REQUESTS_COLLAPSED_FOLDERS_STORAGE_KEY = "bifrost:saved-requests:collapsed-folders:v1";
const IS_MACOS =
    typeof navigator !== "undefined" &&
    /(Mac|iPhone|iPad|iPod)/i.test(navigator.userAgent);
const PRIMARY_SHORTCUT_MODIFIER = IS_MACOS ? "CMD" : "CTRL";
const SHORTCUT_LABELS = {
    saveDraft: `${PRIMARY_SHORTCUT_MODIFIER} + S`,
    newRequest: `${PRIMARY_SHORTCUT_MODIFIER} + T`,
    duplicateRequest: `${PRIMARY_SHORTCUT_MODIFIER} + D`,
    copyRequest: `${PRIMARY_SHORTCUT_MODIFIER} + C`,
    closeTab: `${PRIMARY_SHORTCUT_MODIFIER} + W`,
    renameRequest: `${PRIMARY_SHORTCUT_MODIFIER} + E`,
    deleteRequest: IS_MACOS ? "CMD + Backspace" : "CTRL + Delete",
} as const;
const DYNAMIC_VARIABLE_NAMES = [
    "$timestamp",
    "$timestampSeconds",
    "$uuid",
    "$randomInt",
] as const;
const DYNAMIC_VARIABLE_PREVIEWS: Record<string, string> = {
    "$timestamp": "Generated at runtime (Unix timestamp in ms)",
    "$timestampseconds": "Generated at runtime (Unix timestamp in seconds)",
    "$uuid": "Generated at runtime (UUID v4)",
    "$randomint": "Generated at runtime (0-999)",
};

function areExpandedFoldersEqual(
    left: Record<string, boolean>,
    right: Record<string, boolean>
): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
        if (left[key] !== right[key]) return false;
    }
    return true;
}

function collapsedFolderIdsFromExpandedState(
    expandedState: Record<string, boolean>,
    validFolderIds: string[]
): string[] {
    const validFolderIdsSet = new Set(validFolderIds);
    return Object.entries(expandedState)
        .filter(
            ([folderId, isExpanded]) =>
                isExpanded === false && validFolderIdsSet.has(folderId)
        )
        .map(([folderId]) => folderId);
}

function buildDefaultAuth(type: RequestAuth["type"]): RequestAuth {
    if (type === "bearer") {
        return { type: "bearer", token: "" };
    }
    if (type === "basic") {
        return { type: "basic", username: "", password: "" };
    }
    if (type === "api_key") {
        return { type: "api_key", key: "", value: "", in: "header" };
    }
    return { type: "none" };
}

function requestScriptsOrDefault(request: Request): RequestScripts {
    return request.scripts ?? { pre_request: "", post_response: "" };
}

function applyEnvironmentMutationsToMap(
    target: Map<string, string>,
    mutations: ScriptEnvironmentMutation[]
) {
    for (const mutation of mutations) {
        if (mutation.type === "set") {
            target.set(mutation.key, mutation.value);
            continue;
        }
        target.delete(mutation.key);
    }
}

function normalizeDynamicVariableKey(name: string): string {
    return name.trim().toLowerCase();
}

function isSupportedDynamicVariable(name: string): boolean {
    const normalized = normalizeDynamicVariableKey(name);
    return DYNAMIC_VARIABLE_NAMES.some((entry) => entry.toLowerCase() === normalized);
}

function dynamicVariablePreview(name: string): string | undefined {
    return DYNAMIC_VARIABLE_PREVIEWS[normalizeDynamicVariableKey(name)];
}

function parseHttpError(error: unknown): { kind: string; message: string; durationMs?: number } {
    const source = error as {
        kind?: unknown;
        message?: unknown;
        duration_ms?: unknown;
    };

    return {
        kind: typeof source?.kind === "string" ? source.kind : "unknown",
        message: typeof source?.message === "string" ? source.message : String(error),
        durationMs: typeof source?.duration_ms === "number" ? source.duration_ms : undefined,
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName.toLowerCase();
    if (tagName === "input" || tagName === "textarea" || tagName === "select") return true;
    if (target.isContentEditable) return true;
    if (target.closest("[contenteditable='true']")) return true;
    return false;
}

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

function sanitizeCollapsedFolderIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const next = new Set<string>();
    for (const entry of value) {
        if (typeof entry !== "string") continue;
        const folderId = entry.trim();
        if (!folderId) continue;
        next.add(folderId);
    }
    return Array.from(next);
}

function readPersistedCollapsedSavedRequestsFoldersState(): PersistedCollapsedFoldersState {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(SAVED_REQUESTS_COLLAPSED_FOLDERS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") return {};

        const next: PersistedCollapsedFoldersState = {};
        for (const [collectionId, value] of Object.entries(parsed as Record<string, unknown>)) {
            const collapsedFolderIds = sanitizeCollapsedFolderIds(value);
            if (collapsedFolderIds.length === 0) continue;
            next[collectionId] = collapsedFolderIds;
        }
        return next;
    } catch {
        return {};
    }
}

function writePersistedCollapsedSavedRequestsFoldersState(state: PersistedCollapsedFoldersState) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(
            SAVED_REQUESTS_COLLAPSED_FOLDERS_STORAGE_KEY,
            JSON.stringify(state)
        );
    } catch {
        // ignore storage write failures
    }
}

function readCollapsedSavedRequestsFolderIdsForCollection(collectionId: string): string[] {
    const state = readPersistedCollapsedSavedRequestsFoldersState();
    return state[collectionId] ?? [];
}

function writeCollapsedSavedRequestsFolderIdsForCollection(
    collectionId: string,
    collapsedFolderIds: string[]
) {
    const state = readPersistedCollapsedSavedRequestsFoldersState();
    const normalized = sanitizeCollapsedFolderIds(collapsedFolderIds);
    if (normalized.length === 0) {
        delete state[collectionId];
    } else {
        state[collectionId] = normalized;
    }
    writePersistedCollapsedSavedRequestsFoldersState(state);
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

function safeFileName(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "collection";
    return trimmed
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
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
    const [scriptReportsByRequestId, setScriptReportsByRequestId] = useState<
        Record<string, RequestScriptExecutionReport>
    >({});
    const [runnerRun, setRunnerRun] = useState<RunnerRun | null>(null);
    const [runnerIterationMode, setRunnerIterationMode] =
        useState<RunnerIterationMode>("collection_iteration");
    const [runnerIterations, setRunnerIterations] = useState(1);
    const [collectionRunStopOnFailure, setCollectionRunStopOnFailure] = useState(true);
    const [sessionVariables, setSessionVariables] = useState<Record<string, string>>({});
    const [responseTab, setResponseTab] = useState<ResponseTabId>("body");
    const [draftsById, setDraftsById] = useState<Record<string, Request>>({});
    const [pending, setPending] = useState(false);
    const [editorText, setEditorText] = useState("");
    const [tab, setTab] = useState<"headers" | "query" | "body" | "auth" | "scripts" | "json">(
        "headers"
    );
    const [contextMenu, setContextMenu] = useState<SidebarContextMenu | null>(null);
    const [rootAddMenu, setRootAddMenu] = useState<RootAddMenu | null>(null);
    const [renameTarget, setRenameTarget] = useState<{ kind: "request" | "folder"; id: string } | null>(null);
    const [renameNameInput, setRenameNameInput] = useState("");
    const [renameError, setRenameError] = useState("");
    const [renameBusy, setRenameBusy] = useState(false);
    const [draggedRequestId, setDraggedRequestId] = useState<string | null>(null);
    const [dropIndicator, setDropIndicator] = useState<RequestDropIndicator | null>(null);
    const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
    const [createFolderModal, setCreateFolderModal] = useState<{ parentFolderId: string | null } | null>(null);
    const [createFolderNameInput, setCreateFolderNameInput] = useState("");
    const [createFolderBusy, setCreateFolderBusy] = useState(false);
    const [createFolderError, setCreateFolderError] = useState("");
    const [moveNodeModal, setMoveNodeModal] = useState<MoveNodeModal | null>(null);
    const [moveNodeTargetFolderId, setMoveNodeTargetFolderId] = useState<string | null>(null);
    const [moveNodeBusy, setMoveNodeBusy] = useState(false);
    const [moveNodeError, setMoveNodeError] = useState("");
    const [createRequestModal, setCreateRequestModal] = useState<CreateRequestModal | null>(null);
    const [createRequestNameInput, setCreateRequestNameInput] = useState("");
    const [createRequestBusy, setCreateRequestBusy] = useState(false);
    const [createRequestError, setCreateRequestError] = useState("");
    const [draggedOpenTabRequestId, setDraggedOpenTabRequestId] = useState<string | null>(null);
    const [openTabDropIndicator, setOpenTabDropIndicator] = useState<OpenTabDropIndicator | null>(null);
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
    const [noCollectionsModalOpen, setNoCollectionsModalOpen] = useState(false);
    const [runnerModalOpen, setRunnerModalOpen] = useState(false);
    const [runnerSelectedRequestIds, setRunnerSelectedRequestIds] = useState<string[]>([]);
    const [updateDownloadModal, setUpdateDownloadModal] = useState<UpdateDownloadModal | null>(null);
    const [updateDownloadBusy, setUpdateDownloadBusy] = useState(false);
    const [updateRestartModal, setUpdateRestartModal] = useState<UpdateRestartModal | null>(null);
    const [updateRestartBusy, setUpdateRestartBusy] = useState(false);
    const [deleteFolderModal, setDeleteFolderModal] = useState<DeleteFolderModal | null>(null);
    const [deleteFolderBusy, setDeleteFolderBusy] = useState(false);
    const [deleteRequestModal, setDeleteRequestModal] = useState<DeleteRequestModal | null>(null);
    const [deleteRequestBusy, setDeleteRequestBusy] = useState(false);
    const [clipboardImportModal, setClipboardImportModal] = useState<ClipboardRequestImportModal | null>(null);
    const [clipboardImportBusy, setClipboardImportBusy] = useState(false);
    const [deleteCollectionModal, setDeleteCollectionModal] = useState<DeleteCollectionModal | null>(null);
    const [deleteEnvironmentModal, setDeleteEnvironmentModal] = useState<DeleteEnvironmentModal | null>(null);
    const [closeDraftModal, setCloseDraftModal] = useState<CloseDraftModal | null>(null);
    const [closeDraftBusy, setCloseDraftBusy] = useState(false);
    const postmanImportInputRef = useRef<HTMLInputElement | null>(null);
    const portableImportInputRef = useRef<HTMLInputElement | null>(null);
    const rootAddButtonRef = useRef<HTMLButtonElement | null>(null);
    const rawJsonEditorRef = useRef<{ getValue: () => string; setValue: (value: string) => void } | null>(null);
    const expandedFoldersRef = useRef<Record<string, boolean>>({});
    const hydratedTabsCollectionIdRef = useRef<string | null>(null);
    const hydratedCollapsedFoldersCollectionIdRef = useRef<string | null>(null);
    const pendingCollapsedFoldersHydrationCollectionIdRef = useRef<string | null>(null);
    const pendingCollapsedFoldersHydrationStateRef = useRef<Record<string, boolean> | null>(null);
    const hydratedRunnerCollectionIdRef = useRef<string | null>(null);
    const hydratedRunnerSelectionCollectionIdRef = useRef<string | null>(null);
    const noCollectionsModalShownRef = useRef(false);
    const runnerSelectedRequestsStateRef = useRef<RunnerSelectedRequestsState>(
        loadRunnerSelectedRequests()
    );
    const collectionRunCancelRef = useRef(false);
    const collectionRunActiveRequestIdRef = useRef<string | null>(null);
    const collectionRunPending = runnerRun?.status === "running";

    function resetCollapsedFoldersHydrationRefs() {
        hydratedCollapsedFoldersCollectionIdRef.current = null;
        pendingCollapsedFoldersHydrationCollectionIdRef.current = null;
        pendingCollapsedFoldersHydrationStateRef.current = null;
    }

    function persistCollapsedFoldersForCollection(
        collectionId: string,
        expandedState: Record<string, boolean>,
        validFolderIds: string[]
    ) {
        const collapsedFolderIds = collapsedFolderIdsFromExpandedState(
            expandedState,
            validFolderIds
        );
        writeCollapsedSavedRequestsFolderIdsForCollection(collectionId, collapsedFolderIds);
    }

    async function clearCurrentCollectionView() {
        setCurrent(null);
        setSelectedRequestId(null);
        setOpenRequestIds([]);
        setResp(null);
        setDraggedRequestId(null);
        setDropIndicator(null);
        expandedFoldersRef.current = {};
        setExpandedFolders({});
        setCreateFolderModal(null);
        setCreateFolderNameInput("");
        setCreateFolderBusy(false);
        setCreateFolderError("");
        setMoveNodeModal(null);
        setMoveNodeTargetFolderId(null);
        setMoveNodeBusy(false);
        setMoveNodeError("");
        setCreateRequestModal(null);
        setCreateRequestNameInput("");
        setCreateRequestBusy(false);
        setCreateRequestError("");
        setRootAddMenu(null);
        setDraggedOpenTabRequestId(null);
        setOpenTabDropIndicator(null);
        setResponsesByRequestId({});
        setScriptReportsByRequestId({});
        setSessionVariables({});
        setRunnerRun(null);
        collectionRunCancelRef.current = false;
        collectionRunActiveRequestIdRef.current = null;
        setRunnerModalOpen(false);
        setRunnerSelectedRequestIds([]);
        setDeleteFolderModal(null);
        setDeleteFolderBusy(false);
        setDeleteRequestModal(null);
        setDeleteRequestBusy(false);
        setClipboardImportModal(null);
        setClipboardImportBusy(false);
        setDeleteEnvironmentModal(null);
        setDraftsById({});
        setCloseDraftModal(null);
        setCloseDraftBusy(false);
        setRenameTarget(null);
        hydratedTabsCollectionIdRef.current = null;
        resetCollapsedFoldersHydrationRefs();
        hydratedRunnerCollectionIdRef.current = null;
        hydratedRunnerSelectionCollectionIdRef.current = null;
    }

    async function reloadCollectionsAndRestoreActive(preferredCollectionId?: string | null) {
        flushCurrentCollapsedFoldersState();
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
                return;
            }

            await loadCollection(
                activeCollectionId,
                null,
                setCurrent,
                setSelectedRequestId,
                setResp
            );
        } catch (e) {
            notifyError(`Failed to load collections: ${errorMessage(e)}`);
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

    const requestsById = useMemo(
        () => new Map((current?.requests ?? []).map((request) => [request.id, request])),
        [current?.requests]
    );

    const collectionFolderOptions = useMemo<FolderOption[]>(
        () => (current ? folderOptions(current.meta.items) : []),
        [current]
    );
    const collectionFolderIds = useMemo(
        () => collectionFolderOptions.map((entry) => entry.folderId),
        [collectionFolderOptions]
    );

    const flushCurrentCollapsedFoldersState = useCallback(() => {
        if (!current) return;
        persistCollapsedFoldersForCollection(
            current.meta.id,
            expandedFoldersRef.current,
            collectionFolderIds
        );
    }, [current, collectionFolderIds]);

    const toggleFolderExpanded = useCallback(
        (folderId: string) => {
            const previous = expandedFoldersRef.current;
            let next: Record<string, boolean>;
            if (previous[folderId] === false) {
                next = { ...previous };
                delete next[folderId];
            } else {
                next = { ...previous, [folderId]: false };
            }

            expandedFoldersRef.current = next;
            setExpandedFolders(next);

            if (current) {
                persistCollapsedFoldersForCollection(current.meta.id, next, collectionFolderIds);
            }
        },
        [current, collectionFolderIds]
    );

    const expandedFolderIds = useMemo(() => {
        const ids = new Set<string>();
        for (const folder of collectionFolderOptions) {
            if (expandedFolders[folder.folderId] !== false) {
                ids.add(folder.folderId);
            }
        }
        return ids;
    }, [collectionFolderOptions, expandedFolders]);

    const sidebarRows = useMemo<SidebarTreeRow[]>(
        () => (current ? buildSidebarRows(current.meta.items, requestsById, expandedFolderIds) : []),
        [current, requestsById, expandedFolderIds]
    );

    const orderedRequests = useMemo(() => {
        if (!current) return [];
        return requestsInTreeOrder(current);
    }, [current]);

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

    const latestRunnerExecutionByRequestId = useMemo(() => {
        const map = new Map<string, RunnerExecutionResult>();
        for (const execution of runnerRun?.executions ?? []) {
            map.set(execution.requestId, execution);
        }
        return map;
    }, [runnerRun?.executions]);

    const selectedResponseStatusText = useMemo(() => {
        if (!selectedRequestId) return status || "Idle";
        const runnerStatus = latestRunnerExecutionByRequestId.get(selectedRequestId)?.statusText;
        const persistedStatus = responsesByRequestId[selectedRequestId]?.statusText;
        if (collectionRunPending && runnerStatus) {
            return runnerStatus;
        }
        if (pending) return "Sending...";
        return persistedStatus ?? runnerStatus ?? (status || "No request sent yet.");
    }, [selectedRequestId, pending, responsesByRequestId, status, latestRunnerExecutionByRequestId, collectionRunPending]);

    const selectedScriptReport = useMemo(() => {
        if (!selectedRequestId) return null;
        return scriptReportsByRequestId[selectedRequestId] ?? null;
    }, [selectedRequestId, scriptReportsByRequestId]);

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

    const runtimeVariableValues = useMemo(() => {
        const values = new Map(activeEnvironmentValues);
        for (const [key, value] of Object.entries(sessionVariables)) {
            const trimmed = key.trim();
            if (!trimmed) continue;
            values.set(trimmed, value);
        }
        return values;
    }, [activeEnvironmentValues, sessionVariables]);

    const variableValuesWithDynamic = useMemo(() => {
        const values = new Map(runtimeVariableValues);
        for (const variableName of DYNAMIC_VARIABLE_NAMES) {
            const preview = dynamicVariablePreview(variableName);
            if (!preview) continue;
            values.set(variableName, preview);
            values.set(variableName.toLowerCase(), preview);
        }
        return values;
    }, [runtimeVariableValues]);

    const variableSuggestions = useMemo(
        () =>
            Array.from(
                new Set([...runtimeVariableValues.keys(), ...DYNAMIC_VARIABLE_NAMES])
            ).sort((a, b) => a.localeCompare(b)),
        [runtimeVariableValues]
    );

    const resolveVariableStatus = useCallback(
        (name: string): VariableStatus => {
            const key = name.trim();
            if (!key) return "missing";
            if (isSupportedDynamicVariable(key)) return "ok";
            return runtimeVariableValues.has(key) ? "ok" : "missing";
        },
        [runtimeVariableValues]
    );

    const resolveVariableValue = useCallback(
        (name: string): string | undefined => {
            const key = name.trim();
            if (!key) return undefined;
            if (isSupportedDynamicVariable(key)) {
                return dynamicVariablePreview(key);
            }
            return runtimeVariableValues.get(key);
        },
        [runtimeVariableValues]
    );

    const {
        beforeMountMonaco,
        editorOptions,
        bindBodyJsonEditor,
        bindBodyRawEditor,
    } = useMonacoVariableSupport({
        variableSuggestions,
        variableValues: variableValuesWithDynamic,
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
            notifyError(`Failed to load environments: ${errorMessage(e)}`);
        }
    }

    const persistScriptEnvironmentMutations = useCallback(
        async (mutations: ScriptEnvironmentMutation[]): Promise<string | null> => {
            if (!activeEnvironmentId || mutations.length === 0) {
                return null;
            }

            const activeEnvironment =
                environments.find((env) => env.id === activeEnvironmentId) ?? null;
            if (!activeEnvironment) {
                return "Active environment not found.";
            }

            const nextMap = new Map<string, string>();
            for (const variable of activeEnvironment.variables) {
                const key = variable.key.trim();
                if (!key) continue;
                nextMap.set(key, variable.value);
            }

            applyEnvironmentMutationsToMap(nextMap, mutations);

            const nextVariables = Array.from(nextMap.entries()).map(([key, value]) => ({
                key,
                value,
            }));

            try {
                await invoke("save_environment", {
                    environment: {
                        id: activeEnvironment.id,
                        name: activeEnvironment.name,
                        variables: nextVariables,
                    },
                });

                setEnvironments((previous) =>
                    previous.map((environment) =>
                        environment.id === activeEnvironment.id
                            ? { ...environment, variables: nextVariables }
                            : environment
                    )
                );

                if (envSelectedId === activeEnvironment.id) {
                    setEnvDraftVars(nextVariables);
                }

                return null;
            } catch (error) {
                return String(error);
            }
        },
        [activeEnvironmentId, environments, envSelectedId]
    );


    useEffect(() => {
        let cancelled = false;

        (async () => {
            const availableUpdate = await checkForUpdate();
            if (cancelled || !availableUpdate) return;
            setUpdateDownloadModal({ version: availableUpdate.version });
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    async function onConfirmDownloadAndInstallUpdate() {
        setUpdateDownloadBusy(true);

        try {
            const installedUpdate = await downloadAndInstallPendingUpdate();
            if (!installedUpdate) {
                notifyError("Failed to install update");
                setUpdateDownloadBusy(false);
                return;
            }

            setUpdateDownloadModal(null);
            setUpdateRestartModal({ version: installedUpdate.version });
            notifySuccess(`Update ${installedUpdate.version} installed`);
            setUpdateDownloadBusy(false);
        } catch (error) {
            notifyError(`Failed to install update: ${errorMessage(error)}`);
            setUpdateDownloadBusy(false);
        }
    }

    async function onConfirmRestartAfterUpdate() {
        setUpdateRestartBusy(true);
        try {
            await restartAfterUpdate();
        } catch (error) {
            notifyError(`Failed to restart app: ${errorMessage(error)}`);
            setUpdateRestartBusy(false);
        }
    }

    useEffect(() => {
        (async () => {
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
                notifyError(`Failed to load drafts: ${errorMessage(e)}`);
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
        setScriptReportsByRequestId({});
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
        if (!current) {
            setRunnerRun(null);
            hydratedRunnerCollectionIdRef.current = null;
            return;
        }

        setRunnerRun(readRunnerRunForCollection(current.meta.id));
        hydratedRunnerCollectionIdRef.current = current.meta.id;
    }, [current?.meta.id]);

    useEffect(() => {
        if (!runnerRun) return;
        setRunnerIterationMode(runnerRun.mode);
        setRunnerIterations(Math.max(1, runnerRun.iterations));
    }, [runnerRun?.runId]);

    useEffect(() => {
        if (!current) return;
        if (hydratedRunnerCollectionIdRef.current !== current.meta.id) return;
        if (runnerRun && runnerRun.collectionId !== current.meta.id) return;
        writeRunnerRunForCollection(current.meta.id, runnerRun);
    }, [current?.meta.id, runnerRun]);

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
        if (!current) return;
        // Important: avoid carrying hydration markers from the previous collection.
        // If we switch quickly, stale markers can let persistence run before re-hydration,
        // which overwrites the target collection collapsed state.
        if (hydratedCollapsedFoldersCollectionIdRef.current !== current.meta.id) {
            resetCollapsedFoldersHydrationRefs();
        }
    }, [current?.meta.id]);

    useEffect(() => {
        if (!current) {
            expandedFoldersRef.current = {};
            setExpandedFolders({});
            resetCollapsedFoldersHydrationRefs();
            return;
        }
        if (hydratedCollapsedFoldersCollectionIdRef.current === current.meta.id) {
            return;
        }
        if (collectionFolderOptions.length === 0) {
            return;
        }

        const validFolderIds = new Set(collectionFolderOptions.map((folder) => folder.folderId));
        const collapsedFolderIds = readCollapsedSavedRequestsFolderIdsForCollection(
            current.meta.id
        ).filter((folderId) => validFolderIds.has(folderId));
        const nextExpandedFolders = collapsedFolderIds.reduce<Record<string, boolean>>(
            (map, folderId) => {
                map[folderId] = false;
                return map;
            },
            {}
        );
        pendingCollapsedFoldersHydrationCollectionIdRef.current = current.meta.id;
        pendingCollapsedFoldersHydrationStateRef.current = nextExpandedFolders;
        expandedFoldersRef.current = nextExpandedFolders;
        setExpandedFolders(nextExpandedFolders);
    }, [current?.meta.id, collectionFolderOptions]);

    useEffect(() => {
        if (!current) return;
        if (pendingCollapsedFoldersHydrationCollectionIdRef.current !== current.meta.id) return;
        const expected = pendingCollapsedFoldersHydrationStateRef.current;
        if (!expected) return;
        if (!areExpandedFoldersEqual(expandedFolders, expected)) return;

        hydratedCollapsedFoldersCollectionIdRef.current = current.meta.id;
        pendingCollapsedFoldersHydrationCollectionIdRef.current = null;
        pendingCollapsedFoldersHydrationStateRef.current = null;
    }, [current?.meta.id, expandedFolders]);

    useEffect(() => {
        if (!current) return;
        const validFolderIds = new Set(collectionFolderOptions.map((folder) => folder.folderId));
        setExpandedFolders((previous) => {
            const next = Object.fromEntries(
                Object.entries(previous).filter(
                    ([folderId, isExpanded]) =>
                        isExpanded === false && validFolderIds.has(folderId)
                )
            ) as Record<string, boolean>;
            const previousKeys = Object.keys(previous);
            const nextKeys = Object.keys(next);
            if (previousKeys.length !== nextKeys.length) {
                expandedFoldersRef.current = next;
                return next;
            }
            for (const key of previousKeys) {
                if (previous[key] !== next[key]) {
                    expandedFoldersRef.current = next;
                    return next;
                }
            }
            expandedFoldersRef.current = previous;
            return previous;
        });
    }, [current?.meta.id, collectionFolderOptions]);

    useEffect(() => {
        if (!current) return;
        if (hydratedCollapsedFoldersCollectionIdRef.current !== current.meta.id) return;
        if (pendingCollapsedFoldersHydrationCollectionIdRef.current === current.meta.id) return;
        persistCollapsedFoldersForCollection(current.meta.id, expandedFolders, collectionFolderIds);
    }, [current?.meta.id, expandedFolders, collectionFolderIds]);

    useEffect(() => {
        setDraggedRequestId(null);
        setDropIndicator(null);
        setDraggedOpenTabRequestId(null);
        setOpenTabDropIndicator(null);
    }, [current?.meta.id]);

    useEffect(() => {
        collectionRunCancelRef.current = false;
        collectionRunActiveRequestIdRef.current = null;
        if (!current) {
            setRunnerSelectedRequestIds([]);
            hydratedRunnerSelectionCollectionIdRef.current = null;
            return;
        }

        const allRequestIds = requestsInTreeOrder(current).map((request) => request.id);
        const restoredSelection = getRunnerSelectedRequestsForCollection(
            current.meta.id,
            allRequestIds,
            runnerSelectedRequestsStateRef.current
        );
        setRunnerSelectedRequestIds(restoredSelection);
        hydratedRunnerSelectionCollectionIdRef.current = current.meta.id;
    }, [current?.meta.id]);

    useEffect(() => {
        if (!current) {
            setRunnerSelectedRequestIds([]);
            return;
        }

        const orderedRequestIds = orderedRequests.map((request) => request.id);
        const validIds = new Set(orderedRequestIds);
        setRunnerSelectedRequestIds((previous) => {
            const previousSet = new Set(previous.filter((requestId) => validIds.has(requestId)));
            const next = orderedRequestIds.filter((requestId) => previousSet.has(requestId));
            if (next.length === previous.length && next.every((requestId, index) => requestId === previous[index])) {
                return previous;
            }
            return next;
        });
    }, [current?.requests, orderedRequests]);

    useEffect(() => {
        if (!current) return;
        if (hydratedRunnerSelectionCollectionIdRef.current !== current.meta.id) return;
        const nextState = setRunnerSelectedRequestsForCollection(
            current.meta.id,
            runnerSelectedRequestIds,
            runnerSelectedRequestsStateRef.current
        );
        if (nextState === runnerSelectedRequestsStateRef.current) return;
        runnerSelectedRequestsStateRef.current = nextState;
        saveRunnerSelectedRequests(nextState);
    }, [current?.meta.id, runnerSelectedRequestIds]);

    useEffect(() => {
        if (!current) return;
        const validIds = new Set(current.requests.map((request) => request.id));
        setOpenRequestIds((previous) => previous.filter((requestId) => validIds.has(requestId)));
    }, [current?.requests]);

    useEffect(() => {
        if (!current || !selectedRequestId) return;
        const validIds = new Set(current.requests.map((request) => request.id));
        if (validIds.has(selectedRequestId)) return;
        setSelectedRequestId(null);
    }, [current?.requests, selectedRequestId]);

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
        if (collections.length > 0) {
            if (noCollectionsModalOpen) {
                setNoCollectionsModalOpen(false);
            }
            noCollectionsModalShownRef.current = false;
            return;
        }
        if (current) return;
        if (collectionsModalOpen || noCollectionsModalOpen) return;
        if (noCollectionsModalShownRef.current) return;

        noCollectionsModalShownRef.current = true;
        setNoCollectionsModalOpen(true);
    }, [collections.length, current, collectionsModalOpen, noCollectionsModalOpen]);

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
            setRootAddMenu(null);
            setDraggedRequestId(null);
            setDropIndicator(null);
            setDraggedOpenTabRequestId(null);
            setOpenTabDropIndicator(null);
            if (!renameBusy) {
                setRenameTarget(null);
                setRenameError("");
            }
            if (!createFolderBusy) {
                setCreateFolderModal(null);
                setCreateFolderError("");
            }
            if (!moveNodeBusy) {
                setMoveNodeModal(null);
                setMoveNodeError("");
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
            setRunnerModalOpen(false);
            if (!closeDraftBusy) {
                setCloseDraftModal(null);
            }
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [renameBusy, createFolderBusy, moveNodeBusy, envBusy, collectionBusy, closeDraftBusy]);

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

                notifySuccess("Request saved");
                return true;
            } catch (e) {
                notifyError(`Failed to save request: ${errorMessage(e)}`);
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

                notifyInfo("Draft discarded");
                return true;
            } catch (e) {
                notifyError(`Failed to discard draft: ${errorMessage(e)}`);
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
            const isCommand = e.ctrlKey || e.metaKey;
            if (!isCommand || e.altKey) return;

            const key = e.key.toLowerCase();

            if (key === "s") {
                e.preventDefault();
                if (isDirty) {
                    void saveDraft();
                }
                return;
            }

            if (key === "enter") {
                if (!selectedRequestId || collectionRunPending) return;
                e.preventDefault();
                triggerSendFromUi();
                return;
            }

            if (key === "t") {
                if (collectionRunPending) return;
                e.preventDefault();
                setContextMenu(null);
                setRootAddMenu(null);
                onNewRequest(null);
                return;
            }

            if (key === "d") {
                if (!current || !selectedRequestId) return;
                if (!openRequestIds.includes(selectedRequestId)) return;
                e.preventDefault();
                setContextMenu(null);
                setRootAddMenu(null);
                void onDuplicateRequest(selectedRequestId);
                return;
            }

            if (key === "c") {
                if (!selectedRequestId || collectionRunPending) return;
                if (isEditableKeyboardTarget(e.target)) return;
                if (window.getSelection()?.toString().trim()) return;
                e.preventDefault();
                setContextMenu(null);
                setRootAddMenu(null);
                void onCopyRequest(selectedRequestId);
                return;
            }

            if (key === "w") {
                if (!selectedRequestId) return;
                if (!openRequestIds.includes(selectedRequestId)) return;
                e.preventDefault();
                setContextMenu(null);
                setRootAddMenu(null);
                requestCloseTab(selectedRequestId);
                return;
            }

            if (key === "e") {
                if (!current || !selectedRequestId) return;
                e.preventDefault();
                const row = sidebarRows.find(
                    (entry): entry is Extract<SidebarTreeRow, { kind: "request" }> =>
                        entry.kind === "request" && entry.requestId === selectedRequestId
                );
                if (row) {
                    openRenameModal(row);
                    return;
                }

                const request = current.requests.find((entry) => entry.id === selectedRequestId);
                if (!request) return;
                setRenameTarget({ kind: "request", id: request.id });
                setRenameNameInput(request.name);
                setRenameError("");
                setContextMenu(null);
                setRootAddMenu(null);
                return;
            }

            if (key === "backspace" || key === "delete") {
                if (!selectedRequestId || collectionRunPending) return;
                if (isEditableKeyboardTarget(e.target)) return;
                e.preventDefault();
                setContextMenu(null);
                setRootAddMenu(null);
                requestDeleteRequest(selectedRequestId);
            }
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [
        isDirty,
        saveDraft,
        current,
        selectedRequestId,
        openRequestIds,
        collectionRunPending,
        sidebarRows,
        sendSelected,
        onCopyRequest,
    ]);

    useEffect(() => {
        async function onPaste(event: ClipboardEvent) {
            if (!current || collectionRunPending) return;

            const clipboardText = event.clipboardData?.getData("text/plain");
            if (typeof clipboardText !== "string" || clipboardText.trim().length === 0) {
                return;
            }

            // Only intercept normal paste when clipboard contains a valid Bifrost payload.
            if (!isBifrostClipboardRequestPayload(clipboardText)) {
                return;
            }

            event.preventDefault();

            const payloadFromEvent = parseBifrostClipboardPayload(clipboardText);
            if (!payloadFromEvent) return;

            try {
                const payloadFromSystemClipboard = await readRequestFromClipboard();
                openClipboardImportModal(payloadFromSystemClipboard ?? payloadFromEvent);
            } catch {
                openClipboardImportModal(payloadFromEvent);
            }
        }

        window.addEventListener("paste", onPaste);
        return () => window.removeEventListener("paste", onPaste);
    }, [current, collectionRunPending, selectedRequestId, sidebarRows, collectionFolderOptions]);

    useEffect(() => {
        if (!clipboardImportModal) return;

        function onKeyDown(event: KeyboardEvent) {
            if (clipboardImportBusy) return;

            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setClipboardImportModal(null);
                return;
            }

            if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                void onConfirmImportClipboardRequest();
            }
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [clipboardImportModal, clipboardImportBusy]);

    async function sendSelected() {
        if (collectionRunPending) return;
        if (!selectedRequestId) return;

        const req =
            draft && draft.id === selectedRequestId
                ? draft
                : current?.requests.find((r) => r.id === selectedRequestId);

        if (!req) return;

        setResp(null);
        setPending(true);
        setStatus("Sending...");
        setScriptReportsByRequestId((previous) => ({
            ...previous,
            [selectedRequestId]: {
                preRequestError: null,
                postResponseError: null,
                tests: [],
            },
        }));
        let preScriptError: string | null = null;
        let preScriptTests: ScriptTestResult[] = [];
        let runtimeVariables = { ...sessionVariables };
        const requestScripts = requestScriptsOrDefault(req);
        const scriptEnvironmentMutations: ScriptEnvironmentMutation[] = [];

        try {
            const preScript = runPreRequestScript({
                script: requestScripts.pre_request,
                request: req,
                runtimeVariables,
                environmentValues: activeEnvironmentValues,
            });
            preScriptError = preScript.error;
            preScriptTests = preScript.tests;
            scriptEnvironmentMutations.push(...preScript.environmentMutations);
            runtimeVariables = preScript.runtimeVariables;
            setSessionVariables(runtimeVariables);
            const requestToSend = preScript.request;

            const r = await invoke<HttpResponseDto>("send_request", {
                requestId: selectedRequestId,
                req: requestToSend,
                environmentId: activeEnvironmentId,
                extraVariables: runtimeVariables,
            });

            const postScript = runPostResponseScript({
                script: requestScriptsOrDefault(requestToSend).post_response,
                request: requestToSend,
                response: r,
                runtimeVariables,
                environmentValues: activeEnvironmentValues,
            });
            scriptEnvironmentMutations.push(...postScript.environmentMutations);
            runtimeVariables = postScript.runtimeVariables;
            setSessionVariables(runtimeVariables);
            const scriptTests = [...preScript.tests, ...postScript.tests];
            const failedScriptTests = scriptTests.filter((test) => test.status === "failed").length;
            setScriptReportsByRequestId((previous) => ({
                ...previous,
                [selectedRequestId]: {
                    preRequestError: preScript.error,
                    postResponseError: postScript.error,
                    tests: scriptTests,
                },
            }));

            const environmentPersistError = await persistScriptEnvironmentMutations(
                scriptEnvironmentMutations
            );

            const scriptIssueCount = [preScript.error, postScript.error].filter((entry) => !!entry).length;
            const scriptErrorSuffix =
                scriptIssueCount > 0 ? ` • script issues ${scriptIssueCount}` : "";
            const scriptTestsSuffix =
                scriptTests.length > 0
                    ? ` • tests ${scriptTests.length - failedScriptTests}/${scriptTests.length}`
                    : "";
            const environmentErrorSuffix = environmentPersistError
                ? " • environment save issue"
                : "";
            const isHttpFailure = r.status >= 400;
            const statusText = isHttpFailure
                ? `❌ HTTP ${r.status} in ${r.duration_ms}ms${scriptErrorSuffix}${scriptTestsSuffix}${environmentErrorSuffix}`
                : `✅ ${r.status} in ${r.duration_ms}ms${scriptErrorSuffix}${scriptTestsSuffix}${environmentErrorSuffix}`;
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
            const environmentPersistError = await persistScriptEnvironmentMutations(
                scriptEnvironmentMutations
            );
            const { kind, message, durationMs } = parseHttpError(e);
            setScriptReportsByRequestId((previous) => ({
                ...previous,
                [selectedRequestId]: {
                    preRequestError: preScriptError,
                    postResponseError: null,
                    tests: preScriptTests,
                },
            }));
            const scriptSuffix = preScriptError ? ` • script issue` : "";
            const environmentErrorSuffix = environmentPersistError
                ? " • environment save issue"
                : "";
            const statusText = `❌ ${kind}: ${message}${durationMs != null ? ` (${durationMs}ms)` : ""}${scriptSuffix}${environmentErrorSuffix}`;
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
        if (collectionRunPending) return;
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

    function triggerSendFromUi() {
        if (!selectedRequestId || collectionRunPending) return;
        setContextMenu(null);
        setRootAddMenu(null);
        void sendSelected();
    }

    function toggleRunnerRequestSelection(requestId: string, selected: boolean) {
        if (collectionRunPending) return;
        setRunnerSelectedRequestIds((previous) => {
            const nextSet = new Set(previous);
            if (selected) {
                nextSet.add(requestId);
            } else {
                nextSet.delete(requestId);
            }
            return orderedRequests
                .map((request) => request.id)
                .filter((id) => nextSet.has(id));
        });
    }

    function toggleRunnerFolderSelection(requestIds: string[], selected: boolean) {
        if (collectionRunPending) return;
        setRunnerSelectedRequestIds((previous) => {
            const nextSet = new Set(previous);
            for (const requestId of requestIds) {
                if (selected) {
                    nextSet.add(requestId);
                } else {
                    nextSet.delete(requestId);
                }
            }
            return orderedRequests
                .map((request) => request.id)
                .filter((id) => nextSet.has(id));
        });
    }

    function selectAllRunnerRequests() {
        if (collectionRunPending) return;
        setRunnerSelectedRequestIds(orderedRequests.map((request) => request.id));
    }

    function clearRunnerRequestSelection() {
        if (collectionRunPending) return;
        setRunnerSelectedRequestIds([]);
    }

    async function runCollection(requestIdsToRun?: string[]) {
        if (!current || collectionRunPending) return;

        const ordered = requestsInTreeOrder(current);
        if (ordered.length === 0) {
            notifyInfo("No request in this collection");
            return;
        }

        const selectedSet = new Set(requestIdsToRun ?? runnerSelectedRequestIds);
        const selected = ordered.filter((request) => selectedSet.has(request.id));
        if (selected.length === 0) {
            notifyInfo("No request selected for this run");
            return;
        }

        const safeIterations = Number.isFinite(runnerIterations)
            ? Math.max(1, Math.floor(runnerIterations))
            : 1;
        const plan = buildRunnerExecutionPlan({
            orderedRequests: ordered,
            selectedRequestIds: selected.map((request) => request.id),
            mode: runnerIterationMode,
            iterations: safeIterations,
        });

        if (plan.length === 0) {
            notifyInfo("No execution planned");
            return;
        }

        const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const startedAt = new Date().toISOString();
        let cancelledByUser = false;
        let currentExecutions = plan.map((item) => createQueuedExecutionResult(runId, item));
        let runVariables: Record<string, string> = { ...sessionVariables };
        const runScriptEnvironmentMutations: ScriptEnvironmentMutation[] = [];

        const initialRun: RunnerRun = {
            runId,
            collectionId: current.meta.id,
            collectionName: current.meta.name,
            mode: runnerIterationMode,
            iterations: safeIterations,
            stopOnFirstFailure: collectionRunStopOnFailure,
            selectedRequestIds: selected.map((request) => request.id),
            startedAt,
            finishedAt: null,
            status: "running",
            plan,
            executions: currentExecutions,
            summary: summarizeRunnerExecutions(currentExecutions, false),
        };

        const requestById = new Map(ordered.map((request) => [request.id, draftsById[request.id] ?? request]));

        function commitRun(
            nextExecutions: RunnerExecutionResult[],
            statusOverride: RunnerRun["status"] | null = null,
            finishedAtOverride: string | null = null
        ) {
            currentExecutions = nextExecutions;
            setRunnerRun((previous) => {
                if (!previous || previous.runId !== runId) return previous;
                const nextStatus = statusOverride ?? previous.status;
                const nextFinishedAt = statusOverride ? finishedAtOverride : previous.finishedAt;
                return {
                    ...previous,
                    status: nextStatus,
                    finishedAt: nextFinishedAt,
                    executions: nextExecutions,
                    summary: summarizeRunnerExecutions(nextExecutions, cancelledByUser),
                };
            });
        }

        function updateExecutionAt(
            planIndex: number,
            patch: Partial<RunnerExecutionResult>
        ): RunnerExecutionResult[] {
            return currentExecutions.map((execution) =>
                execution.planIndex === planIndex
                    ? {
                        ...execution,
                        ...patch,
                    }
                    : execution
            );
        }

        function skipRemainingFrom(planStartIndex: number, reason: string): RunnerExecutionResult[] {
            const now = new Date().toISOString();
            return currentExecutions.map((execution) => {
                if (execution.planIndex <= planStartIndex) return execution;
                if (execution.status !== "queued") return execution;
                return {
                    ...execution,
                    status: "skipped",
                    statusText: reason,
                    finishedAt: now,
                };
            });
        }

        setPending(false);
        setRunnerRun(initialRun);
        setStatus(`Running selection (${plan.length} executions)...`);
        collectionRunCancelRef.current = false;
        collectionRunActiveRequestIdRef.current = null;

        for (let index = 0; index < plan.length; index += 1) {
            const planItem = plan[index];

            if (collectionRunCancelRef.current) {
                cancelledByUser = true;
                commitRun(skipRemainingFrom(planItem.planIndex - 1, "Skipped (run cancelled)"));
                break;
            }

            commitRun(
                updateExecutionAt(planItem.planIndex, {
                    status: "running",
                    statusText: "Running...",
                    startedAt: new Date().toISOString(),
                    finishedAt: null,
                    errorCode: null,
                    errorMessage: null,
                })
            );

            collectionRunActiveRequestIdRef.current = planItem.requestId;

            const requestToSend = requestById.get(planItem.requestId);
            if (!requestToSend) {
                const nextExecutions = updateExecutionAt(planItem.planIndex, {
                    status: "failed",
                    statusText: "❌ missing_request: Request not found in collection",
                    wasSent: false,
                    finishedAt: new Date().toISOString(),
                    errorCode: "missing_request",
                    errorMessage: "Request not found in collection",
                });
                commitRun(nextExecutions);
                if (collectionRunStopOnFailure) {
                    commitRun(
                        skipRemainingFrom(planItem.planIndex, "Skipped (stopped on failure)")
                    );
                    break;
                }
                continue;
            }

            const preScript = runPreRequestScript({
                script: requestScriptsOrDefault(requestToSend).pre_request,
                request: requestToSend,
                runtimeVariables: runVariables,
                environmentValues: activeEnvironmentValues,
            });
            const preRequestScriptError = preScript.error;
            const preRequestScriptTests = preScript.tests;
            runScriptEnvironmentMutations.push(...preScript.environmentMutations);
            runVariables = preScript.runtimeVariables;
            setSessionVariables(runVariables);
            const executableRequest = preScript.request;

            try {
                const response = await invoke<HttpResponseDto>("send_request", {
                    requestId: planItem.requestId,
                    req: executableRequest,
                    environmentId: activeEnvironmentId,
                    extraVariables: runVariables,
                });

                const postScript = runPostResponseScript({
                    script: requestScriptsOrDefault(executableRequest).post_response,
                    request: executableRequest,
                    response,
                    runtimeVariables: runVariables,
                    environmentValues: activeEnvironmentValues,
                });
                const postResponseScriptError = postScript.error;
                const postResponseScriptTests = postScript.tests;
                runScriptEnvironmentMutations.push(...postScript.environmentMutations);
                runVariables = postScript.runtimeVariables;
                setSessionVariables(runVariables);

                const scriptIssues = [preRequestScriptError, postResponseScriptError].filter(
                    (entry) => !!entry
                );
                const totalScriptTests = preRequestScriptTests.length + postResponseScriptTests.length;
                const failedScriptTests = [...preRequestScriptTests, ...postResponseScriptTests].filter(
                    (test) => test.status === "failed"
                ).length;
                const scriptErrorsSuffix =
                    scriptIssues.length > 0 ? ` • script issues ${scriptIssues.length}` : "";
                const scriptTestsSuffix =
                    totalScriptTests > 0
                        ? ` • tests ${totalScriptTests - failedScriptTests}/${totalScriptTests}`
                        : "";
                const isHttpFailure = response.status >= 400;
                const statusText = isHttpFailure
                    ? `❌ HTTP ${response.status} in ${response.duration_ms}ms${scriptErrorsSuffix}${scriptTestsSuffix}`
                    : `✅ ${response.status} in ${response.duration_ms}ms${scriptErrorsSuffix}${scriptTestsSuffix}`;
                commitRun(
                    updateExecutionAt(planItem.planIndex, {
                        status: isHttpFailure ? "failed" : "success",
                        statusText,
                        wasSent: true,
                        finishedAt: new Date().toISOString(),
                        durationMs: response.duration_ms,
                        httpStatus: response.status,
                        errorCode: isHttpFailure ? "http_status" : null,
                        errorMessage: isHttpFailure
                            ? `Request returned HTTP ${response.status}`
                            : null,
                        response: toResponseSnapshot(response),
                        extractedVariables: [],
                        extractionErrors: [],
                        preRequestScriptError,
                        postResponseScriptError,
                        preRequestScriptTests,
                        postResponseScriptTests,
                    })
                );
                setResponsesByRequestId((previous) => ({
                    ...previous,
                    [planItem.requestId]: {
                        response,
                        statusText,
                        updatedAt: new Date().toISOString(),
                    },
                }));
                setScriptReportsByRequestId((previous) => ({
                    ...previous,
                    [planItem.requestId]: {
                        preRequestError: preRequestScriptError,
                        postResponseError: postResponseScriptError,
                        tests: [...preRequestScriptTests, ...postResponseScriptTests],
                    },
                }));

                if (isHttpFailure && collectionRunStopOnFailure) {
                    commitRun(
                        skipRemainingFrom(planItem.planIndex, "Skipped (stopped on failure)")
                    );
                    break;
                }
            } catch (error) {
                const parsed = parseRunnerHttpError(error);
                const requestWasCancelled = parsed.code === "cancelled" || collectionRunCancelRef.current;
                const statusText = requestWasCancelled
                    ? `⛔ ${parsed.message}${parsed.durationMs != null ? ` (${parsed.durationMs}ms)` : ""}`
                    : `❌ ${parsed.code}: ${parsed.message}${parsed.durationMs != null ? ` (${parsed.durationMs}ms)` : ""}`;

                if (requestWasCancelled) {
                    cancelledByUser = true;
                }

                commitRun(
                    updateExecutionAt(planItem.planIndex, {
                        status: requestWasCancelled ? "cancelled" : "failed",
                        statusText,
                        wasSent: parsed.durationMs != null,
                        finishedAt: new Date().toISOString(),
                        durationMs: parsed.durationMs,
                        httpStatus: null,
                        errorCode: parsed.code,
                        errorMessage: parsed.message,
                        response: null,
                        extractedVariables: [],
                        extractionErrors: [],
                        preRequestScriptError,
                        postResponseScriptError: null,
                        preRequestScriptTests,
                        postResponseScriptTests: [],
                    })
                );
                setResponsesByRequestId((previous) => ({
                    ...previous,
                    [planItem.requestId]: {
                        response: previous[planItem.requestId]?.response ?? null,
                        statusText,
                        updatedAt: new Date().toISOString(),
                    },
                }));
                setScriptReportsByRequestId((previous) => ({
                    ...previous,
                    [planItem.requestId]: {
                        preRequestError: preRequestScriptError,
                        postResponseError: null,
                        tests: preRequestScriptTests,
                    },
                }));

                if (requestWasCancelled || collectionRunStopOnFailure) {
                    const reason = requestWasCancelled
                        ? "Skipped (run cancelled)"
                        : "Skipped (stopped on failure)";
                    commitRun(skipRemainingFrom(planItem.planIndex, reason));
                    break;
                }
            } finally {
                collectionRunActiveRequestIdRef.current = null;
            }
        }

        const finishedAt = new Date().toISOString();
        const finalSummary = summarizeRunnerExecutions(currentExecutions, cancelledByUser);
        const finalStatus: RunnerRun["status"] =
            cancelledByUser
                ? "cancelled"
                : finalSummary.failed > 0
                    ? "failed"
                    : "completed";
        commitRun(currentExecutions, finalStatus, finishedAt);

        const environmentPersistError = await persistScriptEnvironmentMutations(
            runScriptEnvironmentMutations
        );
        const environmentErrorSuffix = environmentPersistError
            ? " • environment save issue"
            : "";

        collectionRunActiveRequestIdRef.current = null;
        collectionRunCancelRef.current = false;

        if (finalSummary.wasCancelledByUser) {
            setStatus(
                `⛔ Run cancelled: ${finalSummary.success} success, ${finalSummary.failed} failed, ${finalSummary.cancelled} cancelled, ${finalSummary.skipped} skipped${environmentErrorSuffix}`
            );
            return;
        }

        if (finalSummary.failed > 0) {
            setStatus(
                `❌ Run complete: ${finalSummary.success} success, ${finalSummary.failed} failed, ${finalSummary.skipped} skipped${environmentErrorSuffix}`
            );
            return;
        }

        setStatus(`✅ Run complete: ${finalSummary.success}/${finalSummary.total} success${environmentErrorSuffix}`);
    }

    async function cancelCollectionRun() {
        if (!collectionRunPending) return;
        collectionRunCancelRef.current = true;

        const activeRequestId = collectionRunActiveRequestIdRef.current;
        if (!activeRequestId) {
            setStatus("⛔ Cancelling collection run...");
            return;
        }

        try {
            await invoke("cancel_request", { requestId: activeRequestId });
            setStatus("⛔ Cancelling collection run...");
        } catch (error) {
            setStatus(`❌ Collection cancel failed: ${String(error)}`);
        }
    }

    function setSelection(r: Request) {
        setSelectedRequestId(r.id);
    }

    async function moveNodeInCollection(
        sourceNodeId: string,
        targetNodeId: string,
        position: "before" | "after"
    ) {
        if (!current) return;
        if (sourceNodeId === targetNodeId) return;

        const targetRow = sidebarRows.find((row) => row.nodeId === targetNodeId);
        if (!targetRow) return;

        try {
            await invoke("move_node", {
                collectionId: current.meta.id,
                nodeId: sourceNodeId,
                targetFolderId: targetRow.parentFolderId,
                targetIndex: targetRow.indexInParent + (position === "after" ? 1 : 0),
            });
            await loadCollection(
                current.meta.id,
                selectedRequestId,
                setCurrent,
                setSelectedRequestId,
                setResp
            );
            notifySuccess("Collection order updated");
        } catch (error) {
            notifyError(`Failed to move node: ${errorMessage(error)}`);
        }
    }

    async function moveNodeInsideFolder(sourceNodeId: string, targetFolderId: string) {
        if (!current) return;

        try {
            await invoke("move_node", {
                collectionId: current.meta.id,
                nodeId: sourceNodeId,
                targetFolderId,
                targetIndex: 1_000_000,
            });
            await loadCollection(
                current.meta.id,
                selectedRequestId,
                setCurrent,
                setSelectedRequestId,
                setResp
            );
            notifySuccess("Node moved to folder");
        } catch (error) {
            notifyError(`Failed to move node: ${errorMessage(error)}`);
        }
    }

    function beginRequestDrag(
        e: React.MouseEvent<HTMLElement>,
        nodeId: string
    ) {
        if (e.button !== 0) return;
        setDraggedRequestId(nodeId);
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

    function requestDeleteRequest(requestId: string) {
        if (!current) return;
        const request = current.requests.find((entry) => entry.id === requestId);
        if (!request) return;
        setDeleteRequestModal({ id: request.id, name: request.name });
    }

    async function onDeleteRequest(requestId: string) {
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
        setScriptReportsByRequestId((previous) => {
            const next = { ...previous };
            delete next[requestId];
            return next;
        });
        setCloseDraftModal((previous) =>
            previous?.requestId === requestId ? null : previous
        );

        try {
            await devDelete(
                current,
                requestId,
                setCurrent,
                setSelectedRequestId,
                setResp
            );
            notifySuccess("Request deleted");
        } catch (error) {
            notifyError(`Failed to delete request: ${errorMessage(error)}`);
        }
    }

    async function onConfirmDeleteRequest() {
        if (!deleteRequestModal || deleteRequestBusy) return;
        setDeleteRequestBusy(true);
        const deletingId = deleteRequestModal.id;
        setDeleteRequestModal(null);
        await onDeleteRequest(deletingId);
        setDeleteRequestBusy(false);
    }

    function requestDeleteFolder(folderId: string, folderName: string) {
        setDeleteFolderModal({ id: folderId, name: folderName });
    }

    async function onConfirmDeleteFolder() {
        if (!current || !deleteFolderModal || deleteFolderBusy) return;
        const folderId = deleteFolderModal.id;

        setDeleteFolderBusy(true);
        try {
            await invoke("delete_folder", {
                collectionId: current.meta.id,
                folderId,
            });
            await loadCollection(
                current.meta.id,
                selectedRequestId,
                setCurrent,
                setSelectedRequestId,
                setResp
            );
            setDeleteFolderModal(null);
            notifySuccess("Folder deleted");
        } catch (error) {
            notifyError(`Failed to delete folder: ${errorMessage(error)}`);
        } finally {
            setDeleteFolderBusy(false);
        }
    }

    function buildSafeImportedRequestName(name: string, existing: Request[]): string {
        const trimmedBase = name.trim() || "Imported Request";
        const existingNames = new Set(existing.map((entry) => entry.name));
        if (!existingNames.has(trimmedBase)) {
            return trimmedBase;
        }

        let counter = 2;
        while (existingNames.has(`${trimmedBase} (${counter})`)) {
            counter += 1;
        }
        return `${trimmedBase} (${counter})`;
    }

    function resolveClipboardImportTargetFolderId(): string | null {
        if (!selectedRequestId) return null;
        const row = sidebarRows.find(
            (entry): entry is Extract<SidebarTreeRow, { kind: "request" }> =>
                entry.kind === "request" && entry.requestId === selectedRequestId
        );
        return row?.parentFolderId ?? null;
    }

    function openClipboardImportModal(payload: BifrostClipboardRequestPayloadV1) {
        const targetFolderId = resolveClipboardImportTargetFolderId();
        const targetFolderLabel =
            targetFolderId
                ? collectionFolderOptions.find((entry) => entry.folderId === targetFolderId)?.label ?? null
                : null;

        setClipboardImportModal({
            payload,
            targetFolderId,
            targetFolderLabel,
        });
    }

    function resolveRequestForAction(requestId: string): Request | null {
        if (!current) return null;

        return (
            draftsById[requestId] ??
            current.requests.find((entry) => entry.id === requestId) ??
            null
        );
    }

    async function onCopyRequest(requestId: string) {
        const source = resolveRequestForAction(requestId);
        if (!source) return;

        try {
            await copyRequestToClipboard(source);
            notifySuccess("Copied to clipboard");
        } catch {
            notifyError("Failed to copy");
        }
    }

    async function onCopyAsCurl(requestId: string) {
        const source = resolveRequestForAction(requestId);
        if (!source) return;

        try {
            const curl = buildCurlCommand(source);
            await copyTextToClipboard(curl);
            notifySuccess("Copied as cURL");
        } catch {
            notifyError("Failed to copy");
        }
    }

    async function onConfirmImportClipboardRequest() {
        if (!current || !clipboardImportModal || clipboardImportBusy) return;

        const source = clipboardImportModal.payload.request;
        const importedRequest: Request = {
            ...source,
            id: crypto.randomUUID(),
            name: buildSafeImportedRequestName(source.name, current.requests),
            headers: source.headers.map((entry) => ({ ...entry })),
            query: source.query.map((entry) => ({ ...entry })),
            body: structuredClone(source.body),
            auth: structuredClone(source.auth),
            extractors: source.extractors.map((entry) => ({ ...entry })),
            scripts: { ...source.scripts },
        };

        setClipboardImportBusy(true);
        try {
            await invoke("create_request", {
                collectionId: current.meta.id,
                request: importedRequest,
                parentFolderId: clipboardImportModal.targetFolderId,
            });

            await loadCollection(
                current.meta.id,
                importedRequest.id,
                setCurrent,
                setSelectedRequestId,
                setResp
            );

            setSelection(importedRequest);
            setClipboardImportModal(null);
            notifySuccess("Request imported from clipboard");
        } catch (error) {
            notifyError(`Failed to import from clipboard: ${errorMessage(error)}`);
        } finally {
            setClipboardImportBusy(false);
        }
    }

    async function onDuplicateRequest(requestId: string, targetFolderId?: string | null) {
        if (!current) return;

        try {
            await devDuplicate(
                current,
                requestId,
                setCurrent,
                setSelectedRequestId,
                setResp,
                targetFolderId
            );
            notifySuccess("Request duplicated");
        } catch (error) {
            notifyError(`Failed to duplicate request: ${errorMessage(error)}`);
        }
    }

    function openRenameModal(row: SidebarTreeRow) {
        if (!current) return;
        if (row.kind === "request") {
            const req = current.requests.find((r) => r.id === row.requestId);
            if (!req) return;
            setRenameTarget({ kind: "request", id: row.requestId });
            setRenameNameInput(req.name);
        } else {
            setRenameTarget({ kind: "folder", id: row.folderId });
            setRenameNameInput(row.name);
        }
        setRenameError("");
        setContextMenu(null);
    }

    function closeRenameModal() {
        if (renameBusy) return;
        setRenameTarget(null);
        setRenameError("");
    }

    async function submitRenameModal() {
        if (!current || !renameTarget || renameBusy) return;

        const nextName = renameNameInput.trim();

        if (!nextName) {
            setRenameError("Name cannot be empty.");
            return;
        }

        setRenameBusy(true);
        setRenameError("");

        if (renameTarget.kind === "request") {
            try {
                const source = current.requests.find((r) => r.id === renameTarget.id);
                if (!source) {
                    setRenameError("Source request not found.");
                    setRenameBusy(false);
                    return;
                }

                if (nextName === source.name) {
                    setRenameError("Nothing to rename.");
                    setRenameBusy(false);
                    return;
                }

                const ok = await devRename(
                    current,
                    renameTarget.id,
                    nextName,
                    setCurrent,
                    setSelectedRequestId,
                    setResp
                );

                if (ok) {
                    setDraftsById((prev) => {
                        const existing = prev[renameTarget.id];
                        if (!existing) return prev;
                        const next = { ...prev };
                        next[renameTarget.id] = { ...existing, name: nextName };
                        return next;
                    });
                    setRenameTarget(null);
                    setRenameError("");
                    notifySuccess("Request renamed");
                } else {
                    setRenameError("Rename failed.");
                }
                setRenameBusy(false);
                return;
            } catch (error) {
                setRenameError(`Rename failed: ${errorMessage(error)}`);
                notifyError(`Failed to rename request: ${errorMessage(error)}`);
                setRenameBusy(false);
                return;
            }
        }

        try {
            await invoke("rename_folder", {
                collectionId: current.meta.id,
                folderId: renameTarget.id,
                newName: nextName,
            });
            await loadCollection(
                current.meta.id,
                selectedRequestId,
                setCurrent,
                setSelectedRequestId,
                setResp
            );
            setRenameTarget(null);
            notifySuccess("Folder renamed");
        } catch (error) {
            setRenameError(`Rename failed: ${errorMessage(error)}`);
            notifyError(`Failed to rename folder: ${errorMessage(error)}`);
        } finally {
            setRenameBusy(false);
        }
    }

    function openCreateRequest(parentFolderId: string | null) {
        setCreateRequestModal({ parentFolderId });
        setCreateRequestNameInput("New Request");
        setCreateRequestError("");
    }

    function openNoCollectionsModal() {
        noCollectionsModalShownRef.current = true;
        setNoCollectionsModalOpen(true);
    }

    function onNewRequest(parentFolderId: string | null = null) {
        if (collectionRunPending) return;
        if (!current) {
            if (collections.length === 0) {
                openNoCollectionsModal();
                notifyInfo("No collection available. Create one first");
            } else {
                notifyInfo("Select an active collection before creating a request");
            }
            return;
        }
        openCreateRequest(parentFolderId);
    }

    async function submitCreateRequest() {
        if (!current || !createRequestModal || createRequestBusy) return;

        const name = createRequestNameInput.trim();
        if (!name) {
            setCreateRequestError("Request name cannot be empty.");
            return;
        }

        setCreateRequestBusy(true);
        setCreateRequestError("");
        try {
            await devCreate(
                current,
                setCurrent,
                setSelectedRequestId,
                setResp,
                setSelection,
                createRequestModal.parentFolderId,
                name
            );
            setCreateRequestModal(null);
            notifySuccess("Request created");
        } catch (error) {
            setCreateRequestError(`Create failed: ${errorMessage(error)}`);
            notifyError(`Failed to create request: ${errorMessage(error)}`);
        } finally {
            setCreateRequestBusy(false);
        }
    }

    function openRootAddMenuFromButton() {
        if (!current) return;
        const rect = rootAddButtonRef.current?.getBoundingClientRect();
        if (!rect) return;
        setRootAddMenu({
            x: rect.right - 180,
            y: rect.bottom + 6,
        });
    }

    function openCreateFolder(parentFolderId: string | null) {
        setCreateFolderModal({ parentFolderId });
        setCreateFolderNameInput("");
        setCreateFolderError("");
    }

    async function submitCreateFolder() {
        if (!current || !createFolderModal || createFolderBusy) return;
        const name = createFolderNameInput.trim();
        if (!name) {
            setCreateFolderError("Folder name cannot be empty.");
            return;
        }

        setCreateFolderBusy(true);
        setCreateFolderError("");
        try {
            await invoke("create_folder", {
                collectionId: current.meta.id,
                parentFolderId: createFolderModal.parentFolderId,
                name,
            });
            await loadCollection(
                current.meta.id,
                selectedRequestId,
                setCurrent,
                setSelectedRequestId,
                setResp
            );
            setCreateFolderModal(null);
            notifySuccess("Folder created");
        } catch (error) {
            setCreateFolderError(`Create failed: ${errorMessage(error)}`);
            notifyError(`Failed to create folder: ${errorMessage(error)}`);
        } finally {
            setCreateFolderBusy(false);
        }
    }

    function openMoveNodeModal(row: SidebarTreeRow) {
        setMoveNodeModal({
            nodeId: row.nodeId,
            currentParentFolderId: row.parentFolderId,
            title: row.kind === "folder" ? row.name : row.request?.name ?? row.requestId,
        });
        setMoveNodeTargetFolderId(row.parentFolderId);
        setMoveNodeError("");
    }

    async function submitMoveNodeModal() {
        if (!current || !moveNodeModal || moveNodeBusy) return;
        setMoveNodeBusy(true);
        setMoveNodeError("");
        try {
            await invoke("move_node", {
                collectionId: current.meta.id,
                nodeId: moveNodeModal.nodeId,
                targetFolderId: moveNodeTargetFolderId,
                targetIndex: 1_000_000,
            });
            await loadCollection(
                current.meta.id,
                selectedRequestId,
                setCurrent,
                setSelectedRequestId,
                setResp
            );
            setMoveNodeModal(null);
            notifySuccess("Node moved");
        } catch (error) {
            setMoveNodeError(`Move failed: ${errorMessage(error)}`);
            notifyError(`Failed to move node: ${errorMessage(error)}`);
        } finally {
            setMoveNodeBusy(false);
        }
    }

    async function onSelectEnvironment(environmentId: string | null) {
        try {
            await invoke("set_active_environment", { environmentId });
            setActiveEnvironmentId(environmentId);
            notifySuccess(environmentId ? "Environment selected" : "Environment cleared");
        } catch (e) {
            notifyError(`Failed to select environment: ${errorMessage(e)}`);
        }
    }

    async function onSelectCollection(collectionId: string | null) {
        flushCurrentCollapsedFoldersState();
        try {
            await invoke("set_active_collection", { collectionId });

            if (!collectionId) {
                await clearCurrentCollectionView();
                notifySuccess("Collection cleared");
                return;
            }

            await loadCollection(
                collectionId,
                null,
                setCurrent,
                setSelectedRequestId,
                setResp
            );
            notifySuccess("Collection selected");
        } catch (e) {
            notifyError(`Failed to select collection: ${errorMessage(e)}`);
        }
    }

    function openPostmanImportPicker() {
        postmanImportInputRef.current?.click();
    }

    function openPortableImportPicker() {
        portableImportInputRef.current?.click();
    }

    async function onPostmanImportFileSelected(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        const importToastId = notifyLoading(`Importing ${file.name}...`);
        try {
            const jsonText = await file.text();
            const imported = await invoke<ImportPostmanResult>(
                "import_postman_collection_from_json",
                { jsonText }
            );

            await invoke("set_active_collection", {
                collectionId: imported.collection_id,
            });
            await reloadCollectionsAndRestoreActive(imported.collection_id);

            const warningsSuffix =
                imported.warnings.length > 0
                    ? ` • ${imported.warnings.length} warning(s)`
                    : "";
            notifyDismiss(importToastId);
            notifySuccess(
                `Imported '${imported.collection_name}' (${imported.imported_requests} requests, ${imported.imported_folders} folders)${warningsSuffix}`
            );
        } catch (error) {
            notifyDismiss(importToastId);
            notifyError(`Failed to import Postman collection: ${errorMessage(error)}`);
        }
    }

    async function onPortableImportFileSelected(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        const importToastId = notifyLoading(`Importing ${file.name}...`);
        try {
            const jsonText = await file.text();
            const imported = await invoke<ImportPortableResult>(
                "import_collection_portable_from_json",
                { jsonText }
            );

            await invoke("set_active_collection", {
                collectionId: imported.collection_id,
            });
            await reloadCollectionsAndRestoreActive(imported.collection_id);

            const warningsSuffix =
                imported.warnings.length > 0
                    ? ` • ${imported.warnings.length} warning(s)`
                    : "";
            notifyDismiss(importToastId);
            notifySuccess(
                `Imported '${imported.collection_name}' (${imported.imported_requests} requests)${warningsSuffix}`
            );
        } catch (error) {
            notifyDismiss(importToastId);
            notifyError(`Failed to import portable file: ${errorMessage(error)}`);
        }
    }

    async function onExportPortableCollection() {
        if (!current) return;

        let exportToastId: string | null = null;
        try {
            const appDataDir = await invoke<string>("app_data_dir");
            const suggestedFilePath = `${appDataDir}/${safeFileName(current.meta.name)}.bifrost.portable.json`;
            const userPath = await invoke<string | null>("plugin:dialog|save", {
                options: {
                    defaultPath: suggestedFilePath,
                    filters: [
                        {
                            name: "Bifrost Portable JSON",
                            extensions: ["json"],
                        },
                    ],
                },
            });
            if (!userPath || !userPath.trim()) {
                notifyInfo("Portable export cancelled");
                return;
            }

            exportToastId = notifyLoading(`Exporting '${current.meta.name}'...`);
            await invoke("export_collection_portable_to_file", {
                collectionId: current.meta.id,
                path: userPath.trim(),
            });
            notifyDismiss(exportToastId);
            notifySuccess(`Portable export saved: ${userPath.trim()}`);
        } catch (error) {
            if (exportToastId) {
                notifyDismiss(exportToastId);
            }
            notifyError(`Failed to export portable file: ${errorMessage(error)}`);
        }
    }

    function openCollectionsModal() {
        const selected =
            collections.find((collection) => collection.id === (current?.meta.id ?? "")) ??
            collections[0] ??
            null;
        setNoCollectionsModalOpen(false);
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
            notifySuccess(`Collection created: ${created.name}`);
        } catch (e) {
            setCollectionError(`Create failed: ${errorMessage(e)}`);
            notifyError(`Failed to create collection: ${errorMessage(e)}`);
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
            notifySuccess("Collection saved");
        } catch (e) {
            setCollectionError(`Save failed: ${errorMessage(e)}`);
            notifyError(`Failed to save collection: ${errorMessage(e)}`);
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
            notifySuccess("Collection deleted");
        } catch (e) {
            setCollectionError(`Delete failed: ${errorMessage(e)}`);
            notifyError(`Failed to delete collection: ${errorMessage(e)}`);
        } finally {
            setCollectionBusy(false);
        }
    }

    async function onSetActiveCollectionFromModal() {
        if (!collectionSelectedId || collectionBusy) return;

        setCollectionBusy(true);
        setCollectionError("");
        try {
            flushCurrentCollapsedFoldersState();
            await invoke("set_active_collection", { collectionId: collectionSelectedId });
            await loadCollection(
                collectionSelectedId,
                null,
                setCurrent,
                setSelectedRequestId,
                setResp
            );
            notifySuccess("Collection selected");
        } catch (e) {
            setCollectionError(`Set active failed: ${errorMessage(e)}`);
            notifyError(`Failed to select collection: ${errorMessage(e)}`);
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
        setDeleteEnvironmentModal(null);
        setEnvironmentsModalOpen(true);
    }

    function closeEnvironmentsModal() {
        if (envBusy) return;
        setEnvironmentsModalOpen(false);
        setEnvError("");
        setDeleteEnvironmentModal(null);
    }

    function pickEnvironmentForEdit(environmentId: string) {
        const env = environments.find((e) => e.id === environmentId);
        if (!env) return;
        setEnvSelectedId(env.id);
        setEnvDraftName(env.name);
        setEnvDraftVars(env.variables);
        setEnvError("");
        setDeleteEnvironmentModal(null);
    }

    async function onCreateEnvironment() {
        if (envBusy) return;
        setEnvBusy(true);
        setEnvError("");
        try {
            const created = await invoke<Environment>("create_environment", { name: "New Environment" });
            await reloadEnvironments(created.id);
            notifySuccess("Environment created");
        } catch (e) {
            setEnvError(`Create failed: ${errorMessage(e)}`);
            notifyError(`Failed to create environment: ${errorMessage(e)}`);
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
            notifySuccess("Environment duplicated");
        } catch (e) {
            setEnvError(`Duplicate failed: ${errorMessage(e)}`);
            notifyError(`Failed to duplicate environment: ${errorMessage(e)}`);
        } finally {
            setEnvBusy(false);
        }
    }

    function requestDeleteSelectedEnvironment() {
        if (!envSelectedId || envBusy) return;
        const selected = environments.find((entry) => entry.id === envSelectedId);
        if (!selected) return;
        setDeleteEnvironmentModal({ id: selected.id, name: selected.name });
    }

    async function onDeleteEnvironment() {
        if (!deleteEnvironmentModal || envBusy) return;
        setEnvBusy(true);
        setEnvError("");
        try {
            await invoke("delete_environment", { environmentId: deleteEnvironmentModal.id });
            await reloadEnvironments();
            setDeleteEnvironmentModal(null);
            notifySuccess("Environment deleted");
        } catch (e) {
            setEnvError(`Delete failed: ${errorMessage(e)}`);
            notifyError(`Failed to delete environment: ${errorMessage(e)}`);
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
            notifySuccess("Environment saved");
        } catch (e) {
            setEnvError(`Save failed: ${errorMessage(e)}`);
            notifyError(`Failed to save environment: ${errorMessage(e)}`);
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
                onOpenRawJson={() => setTab("json")}
                onOpenCollectionRunner={() => setRunnerModalOpen(true)}
                onImportPostman={openPostmanImportPicker}
                onImportPortable={openPortableImportPicker}
                onExportPortable={() => void onExportPortableCollection()}
                canSaveDraft={!!current && !!draft && isDirty}
                hasDraft={!!draft}
                canOpenCollectionRunner={!!current}
                canExportCollection={!!current}
                isCollectionRunning={collectionRunPending}
            />
            <input
                ref={postmanImportInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={(event) => void onPostmanImportFileSelected(event)}
            />
            <input
                ref={portableImportInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={(event) => void onPortableImportFileSelected(event)}
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
                        width: 280,
                        minWidth: 280,
                        height: "100%",
                        minHeight: 0,
                        flexShrink: 0,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            minHeight: 0,
                            flex: 1,
                            overflow: "hidden",
                        }}
                    >
                        <div
                            style={{
                                marginTop: 16,
                                marginBottom: 8,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 8,
                                flexShrink: 0,
                            }}
                            onContextMenu={(event) => {
                                event.preventDefault();
                                if (!current) return;
                                setContextMenu(null);
                                setRootAddMenu({ x: event.clientX, y: event.clientY });
                            }}
                        >
                            <h3 style={{ margin: 0 }}>Saved Requests</h3>
                            <div style={{ display: "flex", gap: 6 }}>
                                <button
                                    ref={rootAddButtonRef}
                                    style={{ ...buttonStyle(!current), width: 34, padding: 0 }}
                                    disabled={!current}
                                    onClick={() => {
                                        setContextMenu(null);
                                        openRootAddMenuFromButton();
                                    }}
                                    title="Add..."
                                >
                                    ...
                                </button>
                            </div>
                        </div>

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
                                sidebarRows.map((row) => {
                                    const hasLocalDraft =
                                        row.kind === "request" ? !!draftsById[row.requestId] : false;
                                    const isSelected =
                                        row.kind === "request" && row.requestId === selectedRequestId;
                                    const isFolderCollapsed =
                                        row.kind === "folder" && expandedFolders[row.folderId] === false;
                                    const showDropBefore =
                                        dropIndicator?.nodeId === row.nodeId &&
                                        dropIndicator.position === "before";
                                    const showDropAfter =
                                        dropIndicator?.nodeId === row.nodeId &&
                                        dropIndicator.position === "after";
                                    const showDropInside =
                                        dropIndicator?.nodeId === row.nodeId &&
                                        dropIndicator.position === "inside";
                                    const missingRequest =
                                        row.kind === "request" && row.request === null;
                                    const rowIndentPx =
                                        row.depth * 10 +
                                        (row.kind === "request" && row.parentFolderId ? 6 : 0);

                                    return (
                                        <div
                                            key={`${row.kind}-${row.nodeId}`}
                                            onMouseMove={(e) => {
                                                if (!draggedRequestId || draggedRequestId === row.nodeId) return;
                                                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                                const relativeY = (e.clientY - rect.top) / rect.height;
                                                let position: RequestDropIndicator["position"] = "after";
                                                if (row.kind === "folder") {
                                                    if (relativeY < 0.28) {
                                                        position = "before";
                                                    } else if (relativeY > 0.72) {
                                                        position = "after";
                                                    } else {
                                                        position = "inside";
                                                    }
                                                } else {
                                                    position = relativeY < 0.5 ? "before" : "after";
                                                }
                                                setDropIndicator((previous) =>
                                                    previous?.nodeId === row.nodeId &&
                                                    previous.position === position
                                                        ? previous
                                                        : { nodeId: row.nodeId, position }
                                                );
                                            }}
                                            onMouseUp={(e) => {
                                                if (!draggedRequestId || draggedRequestId === row.nodeId) return;
                                                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                                const relativeY = (e.clientY - rect.top) / rect.height;
                                                let position: RequestDropIndicator["position"] = "after";
                                                if (row.kind === "folder") {
                                                    if (relativeY < 0.28) {
                                                        position = "before";
                                                    } else if (relativeY > 0.72) {
                                                        position = "after";
                                                    } else {
                                                        position = "inside";
                                                    }
                                                } else {
                                                    position = relativeY < 0.5 ? "before" : "after";
                                                }

                                                setDropIndicator(null);
                                                setDraggedRequestId(null);
                                                if (position === "inside" && row.kind === "folder") {
                                                    void moveNodeInsideFolder(draggedRequestId, row.folderId);
                                                    return;
                                                }
                                                void moveNodeInCollection(
                                                    draggedRequestId,
                                                    row.nodeId,
                                                    position === "before" ? "before" : "after"
                                                );
                                            }}
                                            style={requestDropRowStyle(
                                                showDropBefore,
                                                showDropAfter,
                                                showDropInside,
                                                rowIndentPx,
                                                row.kind === "folder" && isFolderCollapsed
                                            )}
                                        >
                                            {showDropBefore && <div style={dropMarkerStyle("before")} />}
                                            <button
                                                onMouseDown={(e) => beginRequestDrag(e, row.nodeId)}
                                                onClick={() => {
                                                    if (row.kind === "folder") {
                                                        toggleFolderExpanded(row.folderId);
                                                        return;
                                                    }
                                                    if (row.request) {
                                                        setSelection(row.request);
                                                    }
                                                }}
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    setRootAddMenu(null);
                                                    if (row.kind === "request" && row.request) {
                                                        setSelection(row.request);
                                                    }
                                                    setContextMenu({
                                                        x: e.clientX,
                                                        y: e.clientY,
                                                        row,
                                                    });
                                                }}
                                                style={{
                                                    ...requestListItemStyle(
                                                        isSelected,
                                                        hasLocalDraft
                                                    ),
                                                    width: "100%",
                                                    minWidth: 0,
                                                    textAlign: "left",
                                                    flexShrink: 0,
                                                    cursor: draggedRequestId === row.nodeId ? "grabbing" : "pointer",
                                                    userSelect: "none",
                                                    paddingLeft: 10,
                                                    opacity: missingRequest ? 0.75 : 1,
                                                }}
                                            >
                                                {row.kind === "folder" ? (
                                                    <span
                                                        style={{
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: 8,
                                                            width: "100%",
                                                            minWidth: 0,
                                                        }}
                                                        title={row.name}
                                                    >
                                                        <span
                                                            style={{
                                                                width: 12,
                                                                display: "inline-flex",
                                                                justifyContent: "center",
                                                                color: "var(--pg-text-muted)",
                                                                flexShrink: 0,
                                                            }}
                                                        >
                                                            {expandedFolders[row.folderId] === false ? "▸" : "▾"}
                                                        </span>
                                                        <svg
                                                            width="14"
                                                            height="14"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            xmlns="http://www.w3.org/2000/svg"
                                                            style={{ flexShrink: 0, color: "var(--pg-text-muted)" }}
                                                        >
                                                            <path
                                                                d="M3 7.5C3 6.67157 3.67157 6 4.5 6H9.1C9.56335 6 9.99834 6.214 10.2789 6.57998L11.4211 8.07002C11.7017 8.436 12.1367 8.65 12.6 8.65H19.5C20.3284 8.65 21 9.32157 21 10.15V17.5C21 18.3284 20.3284 19 19.5 19H4.5C3.67157 19 3 18.3284 3 17.5V7.5Z"
                                                                stroke="currentColor"
                                                                strokeWidth="1.8"
                                                                strokeLinejoin="round"
                                                            />
                                                        </svg>
                                                        <span
                                                            style={{
                                                                flex: 1,
                                                                minWidth: 0,
                                                                overflow: "hidden",
                                                                textOverflow: "ellipsis",
                                                                whiteSpace: "nowrap",
                                                            }}
                                                        >
                                                            {row.name}
                                                        </span>
                                                    </span>
                                                ) : row.request ? (
                                                    <span
                                                        style={{
                                                            display: "block",
                                                            width: "100%",
                                                            minWidth: 0,
                                                            overflow: "hidden",
                                                            textOverflow: "ellipsis",
                                                            whiteSpace: "nowrap",
                                                        }}
                                                        title={`${row.request.method.toUpperCase()} ${row.request.name}`}
                                                    >
                                                        {`${row.request.method.toUpperCase()} ${row.request.name}${
                                                            hasLocalDraft ? " ●" : ""
                                                        }`}
                                                    </span>
                                                ) : (
                                                    <span
                                                        style={{
                                                            display: "block",
                                                            width: "100%",
                                                            minWidth: 0,
                                                            overflow: "hidden",
                                                            textOverflow: "ellipsis",
                                                            whiteSpace: "nowrap",
                                                        }}
                                                        title={`[Missing] ${row.requestId}`}
                                                    >
                                                        {`[Missing] ${row.requestId}`}
                                                    </span>
                                                )}
                                            </button>
                                            {showDropInside && row.kind === "folder" && !isFolderCollapsed && (
                                                <div style={dropMarkerStyle("inside")} />
                                            )}
                                            {showDropInside && row.kind === "folder" && isFolderCollapsed && (
                                                <div style={dropInsideOutlineStyle()} />
                                            )}
                                            {showDropAfter && <div style={dropMarkerStyle("after")} />}
                                        </div>
                                    );
                                })}
                            {current && sidebarRows.length === 0 && (
                                <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                                    Empty collection. Create a request or a folder.
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
                                            title={`Close tab (${SHORTCUT_LABELS.closeTab})`}
                                        >
                                            ×
                                        </button>
                                        </div>
                                        {showDropAfter && <div style={openTabDropMarkerStyle("after")} />}
                                    </div>
                                );
                            })}

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
                                    onClick={triggerSendFromUi}
                                    disabled={!selectedRequestId || pending || collectionRunPending}
                                    style={primaryButtonStyle(!selectedRequestId || pending || collectionRunPending)}
                                >
                                    Send
                                </button>

                                <button
                                    onClick={cancel}
                                    disabled={!selectedRequestId || !pending || collectionRunPending}
                                    style={buttonStyle(!selectedRequestId || !pending || collectionRunPending)}
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
                                <button
                                    onClick={() => setTab("auth")}
                                    style={editorTabStyle(tab === "auth")}
                                >
                                    Auth
                                </button>
                                <button
                                    onClick={() => setTab("scripts")}
                                    style={editorTabStyle(tab === "scripts")}
                                >
                                    Scripts
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
                                    onSubmitShortcut={triggerSendFromUi}
                                />
                            )}

                            {tab === "auth" &&
                                (() => {
                                    const auth = draft.auth;

                                    return (
                                        <div
                                            style={{
                                                marginTop: 12,
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: 10,
                                            }}
                                        >
                                            <div style={{ display: "grid", gap: 6 }}>
                                                <span style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 600 }}>
                                                    Auth type
                                                </span>
                                                <select
                                                    value={auth.type}
                                                    onChange={(event) =>
                                                        updateDraft({
                                                            auth: buildDefaultAuth(event.target.value as RequestAuth["type"]),
                                                        })
                                                    }
                                                    style={selectStyle()}
                                                >
                                                    <option value="none">None</option>
                                                    <option value="bearer">Bearer token</option>
                                                    <option value="basic">Basic auth</option>
                                                    <option value="api_key">API key</option>
                                                </select>
                                            </div>

                                            {auth.type === "bearer" && (
                                                <div style={{ display: "grid", gap: 6 }}>
                                                    <span style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 600 }}>
                                                        Token
                                                    </span>
                                                    <VariableInput
                                                        value={auth.token}
                                                        onChange={(token) =>
                                                            updateDraft({
                                                                auth: { type: "bearer", token },
                                                            })
                                                        }
                                                        placeholder="{{token}}"
                                                        resolveVariableStatus={resolveVariableStatus}
                                                        resolveVariableValue={resolveVariableValue}
                                                        variableSuggestions={variableSuggestions}
                                                    />
                                                </div>
                                            )}

                                            {auth.type === "basic" && (
                                                <>
                                                    <div style={{ display: "grid", gap: 6 }}>
                                                        <span style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 600 }}>
                                                            Username
                                                        </span>
                                                        <VariableInput
                                                            value={auth.username}
                                                            onChange={(username) =>
                                                                updateDraft({
                                                                    auth: {
                                                                        type: "basic",
                                                                        username,
                                                                        password: auth.password,
                                                                    },
                                                                })
                                                            }
                                                            placeholder="{{username}}"
                                                            resolveVariableStatus={resolveVariableStatus}
                                                            resolveVariableValue={resolveVariableValue}
                                                            variableSuggestions={variableSuggestions}
                                                        />
                                                    </div>
                                                    <div style={{ display: "grid", gap: 6 }}>
                                                        <span style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 600 }}>
                                                            Password
                                                        </span>
                                                        <VariableInput
                                                            value={auth.password}
                                                            onChange={(password) =>
                                                                updateDraft({
                                                                    auth: {
                                                                        type: "basic",
                                                                        username: auth.username,
                                                                        password,
                                                                    },
                                                                })
                                                            }
                                                            placeholder="{{password}}"
                                                            resolveVariableStatus={resolveVariableStatus}
                                                            resolveVariableValue={resolveVariableValue}
                                                            variableSuggestions={variableSuggestions}
                                                        />
                                                    </div>
                                                </>
                                            )}

                                            {auth.type === "api_key" && (
                                                <>
                                                    <div style={{ display: "grid", gap: 6 }}>
                                                        <span style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 600 }}>
                                                            Add to
                                                        </span>
                                                        <select
                                                            value={auth.in}
                                                            onChange={(event) =>
                                                                updateDraft({
                                                                    auth: {
                                                                        type: "api_key",
                                                                        key: auth.key,
                                                                        value: auth.value,
                                                                        in: event.target.value as "header" | "query",
                                                                    },
                                                                })
                                                            }
                                                            style={selectStyle()}
                                                        >
                                                            <option value="header">Header</option>
                                                            <option value="query">Query</option>
                                                        </select>
                                                    </div>

                                                    <div style={{ display: "grid", gap: 6 }}>
                                                        <span style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 600 }}>
                                                            Key
                                                        </span>
                                                        <VariableInput
                                                            value={auth.key}
                                                            onChange={(key) =>
                                                                updateDraft({
                                                                    auth: {
                                                                        type: "api_key",
                                                                        key,
                                                                        value: auth.value,
                                                                        in: auth.in,
                                                                    },
                                                                })
                                                            }
                                                            placeholder="x-api-key"
                                                            resolveVariableStatus={resolveVariableStatus}
                                                            resolveVariableValue={resolveVariableValue}
                                                            variableSuggestions={variableSuggestions}
                                                        />
                                                    </div>

                                                    <div style={{ display: "grid", gap: 6 }}>
                                                        <span style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 600 }}>
                                                            Value
                                                        </span>
                                                        <VariableInput
                                                            value={auth.value}
                                                            onChange={(value) =>
                                                                updateDraft({
                                                                    auth: {
                                                                        type: "api_key",
                                                                        key: auth.key,
                                                                        value,
                                                                        in: auth.in,
                                                                    },
                                                                })
                                                            }
                                                            placeholder="{{api_key}}"
                                                            resolveVariableStatus={resolveVariableStatus}
                                                            resolveVariableValue={resolveVariableValue}
                                                            variableSuggestions={variableSuggestions}
                                                        />
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    );
                                })()}

                            {tab === "scripts" && (
                                <RequestScriptsEditor
                                    scripts={requestScriptsOrDefault(draft)}
                                    selectedRequestId={selectedRequestId}
                                    beforeMountMonaco={beforeMountMonaco}
                                    editorOptions={editorOptions}
                                    editorPanelStyle={editorPanelStyle}
                                    onChange={(next) => updateDraft({ scripts: next })}
                                />
                            )}

                            {tab === "json" && (
                                <>
                                    <div style={editorPanelStyle("52vh", 360)}>
                                        <Editor
                                            key={`request-json-${selectedRequestId ?? "none"}`}
                                            height="100%"
                                            language="json"
                                            path={`/bifrost-dev/${selectedRequestId ?? "none"}.json`}
                                            theme="bifrost-midnight"
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
                                scriptReport={selectedScriptReport}
                                runtimeVariables={sessionVariables}
                                onClearRuntimeVariables={() => setSessionVariables({})}
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

            {rootAddMenu && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 1190,
                    }}
                    onClick={() => setRootAddMenu(null)}
                >
                    <div
                        style={{
                            position: "fixed",
                            top: rootAddMenu.y,
                            left: rootAddMenu.x,
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
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            style={{ ...buttonStyle(false), width: "100%", textAlign: "left" }}
                            onClick={() => {
                                setRootAddMenu(null);
                                onNewRequest(null);
                            }}
                            title={`Add request (${SHORTCUT_LABELS.newRequest})`}
                        >
                            <span
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    width: "100%",
                                }}
                            >
                                <span>Add request</span>
                                <span
                                    style={{
                                        fontSize: 11,
                                        color: "var(--pg-text-muted)",
                                        fontFamily: '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace',
                                    }}
                                >
                                    {SHORTCUT_LABELS.newRequest}
                                </span>
                            </span>
                        </button>
                        <button
                            style={{ ...buttonStyle(false), width: "100%", textAlign: "left" }}
                            onClick={() => {
                                setRootAddMenu(null);
                                openCreateFolder(null);
                            }}
                        >
                            Add folder
                        </button>
                        <button
                            style={{ ...buttonStyle(false), width: "100%", textAlign: "left" }}
                            onClick={() => invoke("open_app_data_dir")}
                        >
                            Open data folder
                        </button>
                    </div>
                </div>
            )}

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
                            onClick={() => openRenameModal(contextMenu.row)}
                            title={
                                contextMenu.row.kind === "request"
                                    ? `Rename (${SHORTCUT_LABELS.renameRequest})`
                                    : "Rename"
                            }
                        >
                            <span
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    width: "100%",
                                }}
                            >
                                <span>Rename</span>
                                {contextMenu.row.kind === "request" && (
                                    <span
                                        style={{
                                            fontSize: 11,
                                            color: "var(--pg-text-muted)",
                                            fontFamily: '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace',
                                        }}
                                    >
                                        {SHORTCUT_LABELS.renameRequest}
                                    </span>
                                )}
                            </span>
                        </button>

                        {contextMenu.row.kind === "request" && (
                            <button
                                style={{ ...buttonStyle(false), width: "100%", textAlign: "left" }}
                                onClick={() => {
                                    const row = contextMenu.row as Extract<SidebarTreeRow, { kind: "request" }>;
                                    setContextMenu(null);
                                    void onDuplicateRequest(row.requestId, row.parentFolderId);
                                }}
                                title={`Duplicate (${SHORTCUT_LABELS.duplicateRequest})`}
                            >
                                <span
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 12,
                                        width: "100%",
                                    }}
                                >
                                    <span>Duplicate</span>
                                    <span
                                        style={{
                                            fontSize: 11,
                                            color: "var(--pg-text-muted)",
                                            fontFamily: '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace',
                                        }}
                                    >
                                        {SHORTCUT_LABELS.duplicateRequest}
                                    </span>
                                </span>
                            </button>
                        )}

                        {contextMenu.row.kind === "request" && (
                            <button
                                style={{ ...buttonStyle(false), width: "100%", textAlign: "left" }}
                                onClick={() => {
                                    const row = contextMenu.row as Extract<SidebarTreeRow, { kind: "request" }>;
                                    setContextMenu(null);
                                    void onCopyRequest(row.requestId);
                                }}
                                title={`Copy request (${SHORTCUT_LABELS.copyRequest})`}
                            >
                                <span
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 12,
                                        width: "100%",
                                    }}
                                >
                                    <span>Copy Request</span>
                                    <span
                                        style={{
                                            fontSize: 11,
                                            color: "var(--pg-text-muted)",
                                            fontFamily: '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace',
                                        }}
                                    >
                                        {SHORTCUT_LABELS.copyRequest}
                                    </span>
                                </span>
                            </button>
                        )}

                        {contextMenu.row.kind === "request" && (
                            <button
                                style={{ ...buttonStyle(false), width: "100%", textAlign: "left" }}
                                onClick={() => {
                                    const row = contextMenu.row as Extract<SidebarTreeRow, { kind: "request" }>;
                                    setContextMenu(null);
                                    void onCopyAsCurl(row.requestId);
                                }}
                            >
                                Copy as cURL
                            </button>
                        )}

                        {contextMenu.row.kind === "folder" && (
                            <button
                                style={{ ...buttonStyle(false), width: "100%", textAlign: "left" }}
                                onClick={() => {
                                    const row = contextMenu.row as Extract<SidebarTreeRow, { kind: "folder" }>;
                                    setContextMenu(null);
                                    onNewRequest(row.folderId);
                                }}
                            >
                                New request
                            </button>
                        )}

                        {contextMenu.row.kind === "folder" && (
                            <button
                                style={{ ...buttonStyle(false), width: "100%", textAlign: "left" }}
                                onClick={() => {
                                    const row = contextMenu.row as Extract<SidebarTreeRow, { kind: "folder" }>;
                                    setContextMenu(null);
                                    openCreateFolder(row.folderId);
                                }}
                            >
                                New folder
                            </button>
                        )}

                        <button
                            style={{ ...buttonStyle(false), width: "100%", textAlign: "left" }}
                            onClick={() => {
                                setContextMenu(null);
                                openMoveNodeModal(contextMenu.row);
                            }}
                        >
                            Move to...
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
                                if (contextMenu.row.kind === "folder") {
                                    requestDeleteFolder(contextMenu.row.folderId, contextMenu.row.name);
                                    return;
                                }
                                requestDeleteRequest(contextMenu.row.requestId);
                            }}
                            title={
                                contextMenu.row.kind === "request"
                                    ? `Delete (${SHORTCUT_LABELS.deleteRequest})`
                                    : "Delete"
                            }
                        >
                            <span
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    width: "100%",
                                }}
                            >
                                <span>Delete</span>
                                {contextMenu.row.kind === "request" && (
                                    <span
                                        style={{
                                            fontSize: 11,
                                            color: "var(--pg-text-muted)",
                                            fontFamily: '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace',
                                        }}
                                    >
                                        {SHORTCUT_LABELS.deleteRequest}
                                    </span>
                                )}
                            </span>
                        </button>
                    </div>
                </div>
            )}

            {renameTarget && (
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
                        <h3 style={{ margin: 0 }}>
                            Rename {renameTarget.kind === "folder" ? "folder" : "request"}
                        </h3>

                        <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                            {renameTarget.kind === "folder" ? "Folder id" : "Request id"}:{" "}
                            <code style={{ color: "var(--pg-text)" }}>
                                {renameTarget.id}
                            </code>
                        </div>

                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>Name</span>
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

            {createRequestModal && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 1310,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                    }}
                    onMouseDown={() => {
                        if (!createRequestBusy) setCreateRequestModal(null);
                    }}
                >
                    <form
                        onMouseDown={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                            if (event.key === "Escape" && !createRequestBusy) {
                                event.preventDefault();
                                setCreateRequestModal(null);
                            }
                        }}
                        onSubmit={(event) => {
                            event.preventDefault();
                            void submitCreateRequest();
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
                        <h3 style={{ margin: 0 }}>Create request</h3>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>Request name</span>
                            <input
                                value={createRequestNameInput}
                                onChange={(event) => setCreateRequestNameInput(event.target.value)}
                                disabled={createRequestBusy}
                                autoFocus
                            />
                        </label>
                        {createRequestError && (
                            <div style={{ color: "var(--pg-danger)", fontSize: 13 }}>{createRequestError}</div>
                        )}
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button
                                type="button"
                                onClick={() => setCreateRequestModal(null)}
                                disabled={createRequestBusy}
                                style={buttonStyle(createRequestBusy)}
                            >
                                Cancel
                            </button>
                            <button type="submit" disabled={createRequestBusy} style={primaryButtonStyle(createRequestBusy)}>
                                {createRequestBusy ? "Creating..." : "Create"}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {createFolderModal && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 1320,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                    }}
                    onMouseDown={() => {
                        if (!createFolderBusy) setCreateFolderModal(null);
                    }}
                >
                    <form
                        onMouseDown={(event) => event.stopPropagation()}
                        onSubmit={(event) => {
                            event.preventDefault();
                            void submitCreateFolder();
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
                        <h3 style={{ margin: 0 }}>Create folder</h3>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>Folder name</span>
                            <input
                                value={createFolderNameInput}
                                onChange={(event) => setCreateFolderNameInput(event.target.value)}
                                disabled={createFolderBusy}
                                autoFocus
                            />
                        </label>
                        {createFolderError && (
                            <div style={{ color: "var(--pg-danger)", fontSize: 13 }}>{createFolderError}</div>
                        )}
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button
                                type="button"
                                onClick={() => setCreateFolderModal(null)}
                                disabled={createFolderBusy}
                                style={buttonStyle(createFolderBusy)}
                            >
                                Cancel
                            </button>
                            <button type="submit" disabled={createFolderBusy} style={primaryButtonStyle(createFolderBusy)}>
                                {createFolderBusy ? "Creating..." : "Create"}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {moveNodeModal && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 1330,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                    }}
                    onMouseDown={() => {
                        if (!moveNodeBusy) setMoveNodeModal(null);
                    }}
                >
                    <form
                        onMouseDown={(event) => event.stopPropagation()}
                        onSubmit={(event) => {
                            event.preventDefault();
                            void submitMoveNodeModal();
                        }}
                        style={{
                            width: "100%",
                            maxWidth: 520,
                            border: "1px solid var(--pg-border)",
                            borderRadius: 12,
                            background: "var(--pg-surface-1)",
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                        }}
                    >
                        <h3 style={{ margin: 0 }}>Move</h3>
                        <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                            Item: <span style={{ color: "var(--pg-text)" }}>{moveNodeModal.title}</span>
                        </div>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>Destination folder</span>
                            <select
                                value={moveNodeTargetFolderId ?? ""}
                                onChange={(event) =>
                                    setMoveNodeTargetFolderId(event.target.value ? event.target.value : null)
                                }
                                disabled={moveNodeBusy}
                                style={selectStyle()}
                            >
                                <option value="">Root</option>
                                {collectionFolderOptions.map((entry) => (
                                    <option key={entry.folderId} value={entry.folderId}>
                                        {entry.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {moveNodeError && (
                            <div style={{ color: "var(--pg-danger)", fontSize: 13 }}>{moveNodeError}</div>
                        )}
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button
                                type="button"
                                onClick={() => setMoveNodeModal(null)}
                                disabled={moveNodeBusy}
                                style={buttonStyle(moveNodeBusy)}
                            >
                                Cancel
                            </button>
                            <button type="submit" disabled={moveNodeBusy} style={primaryButtonStyle(moveNodeBusy)}>
                                {moveNodeBusy ? "Moving..." : "Move"}
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

            {updateDownloadModal && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 1365,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                    }}
                    onMouseDown={() => {
                        if (!updateDownloadBusy) {
                            setUpdateDownloadModal(null);
                        }
                    }}
                >
                    <div
                        onMouseDown={(event) => event.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 500,
                            border: "1px solid var(--pg-border)",
                            borderRadius: 12,
                            background: "var(--pg-surface-1)",
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                        }}
                    >
                        <h3 style={{ margin: 0 }}>Update available</h3>
                        <div style={{ fontSize: 13, color: "var(--pg-text-dim)", lineHeight: 1.5 }}>
                            Bifrost v{updateDownloadModal.version} is available.
                            Download and install now?
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button
                                onClick={() => setUpdateDownloadModal(null)}
                                disabled={updateDownloadBusy}
                                style={buttonStyle(updateDownloadBusy)}
                            >
                                Later
                            </button>
                            <button
                                onClick={() => void onConfirmDownloadAndInstallUpdate()}
                                disabled={updateDownloadBusy}
                                style={primaryButtonStyle(updateDownloadBusy)}
                            >
                                {updateDownloadBusy ? "Installing..." : "Download & Install"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {updateRestartModal && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 1370,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                    }}
                    onMouseDown={() => {
                        if (!updateRestartBusy) {
                            setUpdateRestartModal(null);
                        }
                    }}
                >
                    <div
                        onMouseDown={(event) => event.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 500,
                            border: "1px solid var(--pg-border)",
                            borderRadius: 12,
                            background: "var(--pg-surface-1)",
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                        }}
                    >
                        <h3 style={{ margin: 0 }}>Update ready</h3>
                        <div style={{ fontSize: 13, color: "var(--pg-text-dim)", lineHeight: 1.5 }}>
                            Bifrost v{updateRestartModal.version} has been installed.
                            Restart now to apply the update?
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button
                                onClick={() => setUpdateRestartModal(null)}
                                disabled={updateRestartBusy}
                                style={buttonStyle(updateRestartBusy)}
                            >
                                Later
                            </button>
                            <button
                                onClick={() => void onConfirmRestartAfterUpdate()}
                                disabled={updateRestartBusy}
                                style={primaryButtonStyle(updateRestartBusy)}
                            >
                                {updateRestartBusy ? "Restarting..." : "Restart now"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {clipboardImportModal && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 1460,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                    }}
                    onMouseDown={() => {
                        if (!clipboardImportBusy) setClipboardImportModal(null);
                    }}
                >
                    <div
                        onMouseDown={(event) => event.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 560,
                            border: "1px solid var(--pg-border)",
                            borderRadius: 12,
                            background: "var(--pg-surface-1)",
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                        }}
                    >
                        <h3 style={{ margin: 0 }}>Import request from clipboard</h3>
                        <div style={{ fontSize: 13, color: "var(--pg-text-dim)", lineHeight: 1.5 }}>
                            A Bifrost request payload was detected in your system clipboard.
                            Confirm import into the current collection.
                        </div>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "120px 1fr",
                                gap: "6px 10px",
                                fontSize: 13,
                            }}
                        >
                            <span style={{ color: "var(--pg-text-muted)" }}>Name</span>
                            <span>{clipboardImportModal.payload.request.name}</span>
                            <span style={{ color: "var(--pg-text-muted)" }}>Method</span>
                            <span>{clipboardImportModal.payload.request.method.toUpperCase()}</span>
                            <span style={{ color: "var(--pg-text-muted)" }}>URL</span>
                            <span style={{ wordBreak: "break-all" }}>{clipboardImportModal.payload.request.url || "-"}</span>
                            <span style={{ color: "var(--pg-text-muted)" }}>Collection</span>
                            <span>{current?.meta.name ?? "-"}</span>
                            <span style={{ color: "var(--pg-text-muted)" }}>Folder</span>
                            <span>{clipboardImportModal.targetFolderLabel ?? "Root"}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button
                                onClick={() => setClipboardImportModal(null)}
                                disabled={clipboardImportBusy}
                                style={buttonStyle(clipboardImportBusy)}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => void onConfirmImportClipboardRequest()}
                                disabled={clipboardImportBusy}
                                style={primaryButtonStyle(clipboardImportBusy)}
                            >
                                {clipboardImportBusy ? "Importing..." : "Import"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmationModal
                open={!!deleteFolderModal}
                busy={deleteFolderBusy}
                title="Delete folder"
                message={
                    deleteFolderModal
                        ? `You are about to delete folder "${deleteFolderModal.name}". All requests inside this folder will be permanently deleted. Do you want to continue?`
                        : ""
                }
                confirmLabel="Delete folder"
                onCancel={() => setDeleteFolderModal(null)}
                onConfirm={() => void onConfirmDeleteFolder()}
            />

            <ConfirmationModal
                open={!!deleteRequestModal}
                busy={deleteRequestBusy}
                title="Delete request"
                message={
                    deleteRequestModal
                        ? `You are about to delete "${deleteRequestModal.name}". This action cannot be undone. Do you want to continue?`
                        : ""
                }
                confirmLabel="Delete request"
                onCancel={() => setDeleteRequestModal(null)}
                onConfirm={() => void onConfirmDeleteRequest()}
            />

            <CollectionRunnerModal
                open={runnerModalOpen}
                onClose={() => setRunnerModalOpen(false)}
                collectionId={current?.meta.id ?? null}
                collectionName={current?.meta.name ?? null}
                collectionItems={current?.meta.items ?? []}
                orderedRequests={orderedRequests}
                selectedRequestIds={runnerSelectedRequestIds}
                runMode={runnerIterationMode}
                iterations={runnerIterations}
                run={runnerRun}
                isRunning={collectionRunPending}
                stopOnFailure={collectionRunStopOnFailure}
                onRunModeChange={setRunnerIterationMode}
                onIterationsChange={setRunnerIterations}
                onStopOnFailureChange={setCollectionRunStopOnFailure}
                onToggleRequestSelection={toggleRunnerRequestSelection}
                onToggleFolderSelection={toggleRunnerFolderSelection}
                onSelectAll={selectAllRunnerRequests}
                onClearSelection={clearRunnerRequestSelection}
                onRun={() => void runCollection(runnerSelectedRequestIds)}
                onCancel={() => void cancelCollectionRun()}
            />

            <NoCollectionsModal
                open={noCollectionsModalOpen}
                onClose={() => setNoCollectionsModalOpen(false)}
                onOpenCollections={openCollectionsModal}
            />

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
                deleteTarget={deleteEnvironmentModal}
                onClose={closeEnvironmentsModal}
                onCreate={() => void onCreateEnvironment()}
                onDuplicate={() => void onDuplicateEnvironment()}
                onRequestDelete={requestDeleteSelectedEnvironment}
                onPickEnvironment={pickEnvironmentForEdit}
                onDraftNameChange={setEnvDraftName}
                onDraftVarsChange={setEnvDraftVars}
                onSetActive={() => {
                    if (!envSelectedId) return;
                    void onSelectEnvironment(envSelectedId);
                }}
                onSave={() => void onSaveEnvironment()}
                onCancelDelete={() => setDeleteEnvironmentModal(null)}
                onConfirmDelete={() => void onDeleteEnvironment()}
            />
        </>
    );
}

function requestListItemStyle(active: boolean, hasLocalDraft: boolean): React.CSSProperties {
    return {
        ...buttonStyle(false),
        height: 30,
        padding: "0 10px",
        borderColor: active
            ? "var(--pg-primary)"
            : hasLocalDraft
                ? "var(--pg-primary-soft)"
                : "var(--pg-border)",
        background: active ? "var(--pg-primary)" : "var(--pg-surface-gradient)",
        boxShadow: active ? "0 8px 16px rgba(var(--pg-primary-rgb), 0.28)" : "none",
        color: active ? "var(--pg-primary-ink)" : "var(--pg-text)",
        fontWeight: active ? 700 : 500,
        fontSize: 12,
    };
}

function requestDropRowStyle(
    dropBefore: boolean,
    dropAfter: boolean,
    dropInside: boolean,
    indentPx: number,
    emphasizeInside: boolean
): React.CSSProperties {
    return {
        position: "relative",
        display: "flex",
        alignItems: "stretch",
        borderRadius: 10,
        paddingTop: 1,
        paddingBottom: 1,
        marginLeft: indentPx,
        background:
            dropBefore || dropAfter || (dropInside && !emphasizeInside)
                ? "rgba(var(--pg-primary-rgb), 0.08)"
                : "transparent",
    };
}

function dropMarkerStyle(position: "before" | "after" | "inside"): React.CSSProperties {
    return {
        position: "absolute",
        left: position === "inside" ? "16%" : 0,
        right: position === "inside" ? "16%" : 0,
        top: position === "inside" ? "calc(50% - 2px)" : position === "before" ? 1 : undefined,
        bottom: position === "after" ? 1 : undefined,
        height: 4,
        borderRadius: 999,
        background: "var(--pg-primary)",
        pointerEvents: "none",
        zIndex: 2,
        boxShadow: "0 0 0 1px rgba(var(--pg-primary-rgb), 0.45), 0 0 10px rgba(var(--pg-primary-rgb), 0.5)",
    };
}

function dropInsideOutlineStyle(): React.CSSProperties {
    return {
        position: "absolute",
        inset: 0,
        borderRadius: 10,
        border: "2px solid var(--pg-primary)",
        boxShadow: "inset 0 0 0 1px rgba(var(--pg-primary-rgb), 0.45)",
        pointerEvents: "none",
        zIndex: 2,
    };
}

function editorTabStyle(active: boolean): React.CSSProperties {
    return {
        ...buttonStyle(false),
        height: 28,
        padding: "0 9px",
        fontSize: 12,
        borderColor: active ? "var(--pg-primary)" : "var(--pg-border)",
        background: active ? "var(--pg-primary)" : "var(--pg-surface-gradient)",
        color: active ? "var(--pg-primary-ink)" : "var(--pg-text)",
    };
}

function draftTabContainerStyle(active: boolean): React.CSSProperties {
    return {
        display: "flex",
        alignItems: "center",
        borderRadius: 9,
        overflow: "hidden",
        border: active ? "1px solid var(--pg-primary)" : "1px solid var(--pg-border)",
        background: active ? "var(--pg-primary)" : "var(--pg-surface-gradient)",
        minWidth: 160,
        boxShadow: active ? "0 8px 16px rgba(var(--pg-primary-rgb), 0.28)" : "none",
    };
}

function draftTabButtonStyle(active: boolean): React.CSSProperties {
    return {
        border: "none",
        background: "transparent",
        color: active ? "var(--pg-primary-ink)" : "var(--pg-text-dim)",
        padding: "6px 10px",
        fontWeight: 600,
        fontSize: 12,
        lineHeight: 1.2,
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
        width: 28,
        height: 28,
        border: "none",
        borderLeft: "1px solid rgba(var(--pg-primary-rgb), 0.3)",
        background: "transparent",
        color: "var(--pg-text-dim)",
        padding: 0,
        borderRadius: 0,
        boxShadow: "none",
        lineHeight: 1,
        fontSize: 14,
    };
}

function openTabDropWrapStyle(dropBefore: boolean, dropAfter: boolean): React.CSSProperties {
    return {
        position: "relative",
        display: "flex",
        alignItems: "stretch",
        borderRadius: 10,
        paddingLeft: 1,
        paddingRight: 1,
        background: dropBefore || dropAfter ? "rgba(var(--pg-primary-rgb), 0.08)" : "transparent",
        flexShrink: 0,
    };
}

function openTabDropMarkerStyle(position: "before" | "after"): React.CSSProperties {
    return {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: position === "before" ? 1 : undefined,
        right: position === "after" ? 1 : undefined,
        width: 4,
        borderRadius: 999,
        background: "var(--pg-primary)",
        pointerEvents: "none",
        zIndex: 2,
        boxShadow: "0 0 0 1px rgba(var(--pg-primary-rgb), 0.45), 0 0 10px rgba(var(--pg-primary-rgb), 0.5)",
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
