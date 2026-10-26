import type { JsonContainer } from "./responseJsonPath.ts";

// Offsets identify structural nodes within one immutable response snapshot.
// The default lets bulk actions remain O(1); overrides preserve nested choices.
export type JsonExpansionDepth = number | "all";
export type JsonFoldState = { collapsed: boolean; depth?: number; overrides: ReadonlySet<number> };
export const expandedJson: JsonFoldState = { collapsed: false, overrides: new Set() };
export function applyJsonDepth(depth: JsonExpansionDepth, previous: JsonFoldState = expandedJson): JsonFoldState {
    // Retain the last numeric choice even through All and subsequent manual folds.
    if (depth === "all") return previous.depth === undefined ? expandedJson : { ...expandedJson, depth: previous.depth };
    return { collapsed: true, depth: Math.max(1, Math.floor(depth)), overrides: new Set() };
}

export function maximumJsonExpansionDepth(containers: readonly JsonContainer[]): number {
    // Root depth is zero. Empty containers have no content to reveal.
    let maximum = 1;
    for (const node of containers) if (node.count > 0) maximum = Math.max(maximum, node.depth + 1);
    return maximum;
}

export function jsonAdjustmentDepth(state: JsonFoldState, maximum: number): number {
    const selected = state.collapsed ? state.depth ?? 1 : state.depth ?? maximum;
    return Math.min(maximum, Math.max(1, jsonDepthSelection(state) === "all" ? maximum : selected));
}
export function jsonDepthSelection(state: JsonFoldState): JsonExpansionDepth | "custom" {
    return state.overrides.size ? "custom" : state.collapsed ? state.depth ?? 1 : "all";
}
export function isJsonCollapsed(state: JsonFoldState, node: JsonContainer): boolean {
    const base = state.collapsed && node.depth >= (state.depth ?? 1);
    return state.overrides.has(node.valueStart) ? !base : base;
}
export function toggleJsonFold(state: JsonFoldState, node: JsonContainer): JsonFoldState {
    const overrides = new Set(state.overrides);
    if (overrides.has(node.valueStart)) overrides.delete(node.valueStart);
    else overrides.add(node.valueStart);
    return { ...state, overrides };
}
export type JsonFoldRange = { start: number; end: number; node: JsonContainer; collapsed: boolean };
export function visibleJsonContainers(containers: readonly JsonContainer[], state: JsonFoldState): JsonFoldRange[] {
    const visible: JsonFoldRange[] = [];
    for (let index = 0; index < containers.length; index++) {
        const node = containers[index];
        if (!node.count) continue;
        const collapsed = isJsonCollapsed(state, node);
        visible.push({ start: node.start, end: collapsed ? node.end : node.valueStart, node, collapsed });
        if (collapsed) {
            let low = index + 1, high = containers.length;
            while (low < high) {
                const mid = (low + high) >>> 1;
                if (containers[mid].valueStart < node.end) low = mid + 1;
                else high = mid;
            }
            index = low - 1;
        }
    }
    return visible;
}

export type JsonFoldSnapshot = { response: unknown; requestId: string | null | undefined; text: string; state: JsonFoldState };
export function resolveJsonFoldSnapshot(previous: JsonFoldSnapshot, response: unknown, requestId: string | null | undefined, text: string): JsonFoldSnapshot {
    return previous.response === response && previous.requestId === requestId && previous.text === text
        ? previous
        : { response, requestId, text, state: expandedJson };
}
