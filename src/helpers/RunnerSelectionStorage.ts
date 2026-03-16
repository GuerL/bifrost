const RUNNER_SELECTED_REQUESTS_STORAGE_KEY = "bifrost:runner:selected-requests:v1";

export type RunnerSelectedRequestsState = Record<string, string[]>;

function sanitizeRequestIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const next: string[] = [];
    const seen = new Set<string>();

    for (const entry of value) {
        if (typeof entry !== "string") continue;
        const requestId = entry.trim();
        if (!requestId || seen.has(requestId)) continue;
        seen.add(requestId);
        next.push(requestId);
    }

    return next;
}

function sanitizeState(value: unknown): RunnerSelectedRequestsState {
    if (!value || typeof value !== "object") return {};

    const next: RunnerSelectedRequestsState = {};
    for (const [collectionId, selectedIds] of Object.entries(value as Record<string, unknown>)) {
        const normalizedCollectionId = collectionId.trim();
        if (!normalizedCollectionId) continue;
        next[normalizedCollectionId] = sanitizeRequestIds(selectedIds);
    }
    return next;
}

function sameStringArray(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) return false;
    }
    return true;
}

export function loadRunnerSelectedRequests(): RunnerSelectedRequestsState {
    if (typeof window === "undefined") return {};

    try {
        const raw = window.localStorage.getItem(RUNNER_SELECTED_REQUESTS_STORAGE_KEY);
        if (!raw) return {};
        return sanitizeState(JSON.parse(raw));
    } catch {
        return {};
    }
}

export function saveRunnerSelectedRequests(state: RunnerSelectedRequestsState) {
    if (typeof window === "undefined") return;

    try {
        window.localStorage.setItem(
            RUNNER_SELECTED_REQUESTS_STORAGE_KEY,
            JSON.stringify(sanitizeState(state))
        );
    } catch {
        // ignore storage write failures
    }
}

export function getRunnerSelectedRequestsForCollection(
    collectionId: string,
    allRequestIds: string[],
    state: RunnerSelectedRequestsState
): string[] {
    const normalizedCollectionId = collectionId.trim();
    const normalizedAllRequestIds = sanitizeRequestIds(allRequestIds);
    if (!normalizedCollectionId) return normalizedAllRequestIds;

    if (!Object.prototype.hasOwnProperty.call(state, normalizedCollectionId)) {
        return normalizedAllRequestIds;
    }

    const selectedSet = new Set(sanitizeRequestIds(state[normalizedCollectionId]));
    return normalizedAllRequestIds.filter((requestId) => selectedSet.has(requestId));
}

export function setRunnerSelectedRequestsForCollection(
    collectionId: string,
    selectedIds: string[],
    prevState: RunnerSelectedRequestsState
): RunnerSelectedRequestsState {
    const normalizedCollectionId = collectionId.trim();
    if (!normalizedCollectionId) return prevState;

    const normalizedSelectedIds = sanitizeRequestIds(selectedIds);
    const previousSelectedIds = sanitizeRequestIds(prevState[normalizedCollectionId]);
    if (sameStringArray(previousSelectedIds, normalizedSelectedIds)) {
        return prevState;
    }

    return {
        ...prevState,
        [normalizedCollectionId]: normalizedSelectedIds,
    };
}
