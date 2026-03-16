import type { RunnerRun } from "./types.ts";

const RUNNER_RUNS_STORAGE_KEY = "bifrost:runner-runs:v1";
const RUNNER_COLLAPSED_FOLDERS_STORAGE_KEY = "bifrost:runner:collapsed-folders:v1";

type RunnerRunsState = Record<string, RunnerRun>;
type RunnerCollapsedFoldersState = Record<string, string[]>;

export function readRunnerRunsState(): RunnerRunsState {
    if (typeof window === "undefined") return {};

    try {
        const raw = window.localStorage.getItem(RUNNER_RUNS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") return {};
        return parsed as RunnerRunsState;
    } catch {
        return {};
    }
}

export function writeRunnerRunsState(state: RunnerRunsState) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(RUNNER_RUNS_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // ignore storage write failures
    }
}

export function readRunnerRunForCollection(collectionId: string): RunnerRun | null {
    const state = readRunnerRunsState();
    return state[collectionId] ?? null;
}

export function writeRunnerRunForCollection(collectionId: string, run: RunnerRun | null) {
    const state = readRunnerRunsState();
    if (!run) {
        delete state[collectionId];
    } else {
        state[collectionId] = run;
    }
    writeRunnerRunsState(state);
}

function sanitizeFolderIds(value: unknown): string[] {
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

export function readRunnerCollapsedFoldersState(): RunnerCollapsedFoldersState {
    if (typeof window === "undefined") return {};

    try {
        const raw = window.localStorage.getItem(RUNNER_COLLAPSED_FOLDERS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") return {};

        const next: RunnerCollapsedFoldersState = {};
        for (const [collectionId, folderIds] of Object.entries(
            parsed as Record<string, unknown>
        )) {
            const normalizedFolderIds = sanitizeFolderIds(folderIds);
            if (normalizedFolderIds.length === 0) continue;
            next[collectionId] = normalizedFolderIds;
        }
        return next;
    } catch {
        return {};
    }
}

export function writeRunnerCollapsedFoldersState(state: RunnerCollapsedFoldersState) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(
            RUNNER_COLLAPSED_FOLDERS_STORAGE_KEY,
            JSON.stringify(state)
        );
    } catch {
        // ignore storage write failures
    }
}

export function readRunnerCollapsedFolderIdsForCollection(collectionId: string): string[] {
    const state = readRunnerCollapsedFoldersState();
    return state[collectionId] ?? [];
}

export function writeRunnerCollapsedFolderIdsForCollection(
    collectionId: string,
    folderIds: string[]
) {
    const state = readRunnerCollapsedFoldersState();
    const normalizedFolderIds = sanitizeFolderIds(folderIds);
    if (normalizedFolderIds.length === 0) {
        delete state[collectionId];
    } else {
        state[collectionId] = normalizedFolderIds;
    }
    writeRunnerCollapsedFoldersState(state);
}
