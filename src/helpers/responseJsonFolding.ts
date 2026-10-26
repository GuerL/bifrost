import type { JsonContainer } from "./responseJsonPath.ts";

// Offsets identify structural nodes within one immutable response snapshot.
// The default lets bulk actions remain O(1); overrides preserve nested choices.
export type JsonDepthPreset = 1 | 2 | 3 | "all";
export type JsonFoldState = { collapsed: boolean; depth?: 1 | 2 | 3; overrides: ReadonlySet<number> };
export const expandedJson: JsonFoldState = { collapsed: false, overrides: new Set() };
export function applyJsonDepth(depth: JsonDepthPreset): JsonFoldState {
    return depth === "all" ? expandedJson : { collapsed: true, depth, overrides: new Set() };
}
export function jsonDepthSelection(state: JsonFoldState): JsonDepthPreset | "custom" {
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
