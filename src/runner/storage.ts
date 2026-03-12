import type { RunnerRun } from "./types.ts";

const RUNNER_RUNS_STORAGE_KEY = "postguerl:runner-runs:v1";

type RunnerRunsState = Record<string, RunnerRun>;

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
