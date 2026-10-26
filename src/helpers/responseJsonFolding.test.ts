import { describe, expect, it } from "vitest";
import { expandedJson, isJsonCollapsed, toggleJsonFold, visibleJsonContainers } from "./responseJsonFolding.ts";
import { indexResponseJson } from "./responseJsonPath.ts";

const fixture = (value: unknown) => {
    const text = JSON.stringify(value, null, 2);
    return { text, index: indexResponseJson(text)! };
};

describe("response JSON folding", () => {
    it("toggles independently and preserves a child's choice while its parent is hidden", () => {
        const { index } = fixture({ parent: { child: [1, 2] }, sibling: { value: true } });
        const [root, parent, child, sibling] = index.containers;
        let state = toggleJsonFold(expandedJson, child);
        state = toggleJsonFold(state, parent);
        expect(visibleJsonContainers(index.containers, state).map(range => range.node)).toEqual([root, parent, sibling]);
        state = toggleJsonFold(state, parent);
        expect(isJsonCollapsed(state, parent)).toBe(false);
        expect(isJsonCollapsed(state, child)).toBe(true);
        expect(isJsonCollapsed(state, sibling)).toBe(false);
        expect(isJsonCollapsed(toggleJsonFold(state, child), child)).toBe(false);
    });

    it("collapses all descendants, keeps the root open, and permits independent toggles afterwards", () => {
        const { index } = fixture([{ nested: [1] }, [2]]);
        const all = { collapsed: true, overrides: new Set<number>() };
        const ranges = visibleJsonContainers(index.containers, all);
        expect(ranges.map(range => range.collapsed)).toEqual([false, true, true]);
        const state = toggleJsonFold(all, index.containers[1]);
        expect(isJsonCollapsed(state, index.containers[1])).toBe(false);
        expect(isJsonCollapsed(state, index.containers[2])).toBe(true);
        expect(visibleJsonContainers(index.containers, expandedJson).every(range => !range.collapsed)).toBe(true);
    });

    it("supports manually folding the root under either bulk default", () => {
        const { index } = fixture({ child: [1] });
        for (const state of [expandedJson, { collapsed: true, overrides: new Set<number>() }]) {
            const folded = toggleJsonFold(state, index.containers[0]);
            expect(visibleJsonContainers(index.containers, folded)).toHaveLength(1);
            expect(isJsonCollapsed(folded, index.containers[0])).toBe(true);
            expect(isJsonCollapsed(toggleJsonFold(folded, index.containers[0]), index.containers[0])).toBe(false);
        }
    });

    it.each([{}, [], null, 1, true, "text"])("has no disclosures for empty or primitive roots: %j", value => {
        expect(visibleJsonContainers(fixture(value).index.containers, expandedJson)).toEqual([]);
    });

    it("preserves original offsets and paths for special keys, array indices and closing delimiters", () => {
        const { text, index } = fixture({ 'a.b': [{ 'quote"\\\n': [1, 2] }], empty: {} });
        const state = { collapsed: true, overrides: new Set<number>() };
        for (const range of visibleJsonContainers(index.containers, state)) {
            expect(index.pathAt(range.start)).toBe(index.pathAt(range.node.start));
            expect(index.pathAt(range.node.end - 1)).toBe(index.pathAt(range.node.start));
        }
        expect(index.pathAt(index.containers[3].valueStart)).toBe('$["a.b"][0]["quote\\\"\\\\\\n"]');
        expect(text.slice(index.containers[1].valueStart, index.containers[1].end)).toContain('1,');
        expect(visibleJsonContainers(index.containers, state).some(range => range.node.count === 0)).toBe(false);
    });

    it("skips a large collapsed subtree and preserves source data", () => {
        const { text, index } = fixture({ items: Array.from({ length: 10000 }, (_, i) => ({ i })), after: [1] });
        const state = toggleJsonFold(expandedJson, index.containers[1]);
        expect(visibleJsonContainers(index.containers, state)).toHaveLength(3);
        expect(index.pathAt(text.indexOf('9999'))).toBe('$.items[9999].i');
        expect(JSON.parse(text).items).toHaveLength(10000);
    });

    it("handles deep nesting without recursive folding calculations", () => {
        let value: unknown = [1];
        for (let i = 0; i < 300; i++) value = { child: value };
        const { index } = fixture(value);
        expect(visibleJsonContainers(index.containers, expandedJson)).toHaveLength(301);
        expect(visibleJsonContainers(index.containers, { collapsed: true, overrides: new Set() })).toHaveLength(2);
    });
});

describe("response fold snapshot isolation", () => {
    it("retains state for unrelated renders but resets for a new response, tab, or structure", async () => {
        const { resolveJsonFoldSnapshot } = await import("./responseJsonFolding.ts");
        const response = { body_text: '{"a":[1]}' };
        const previous = { response, requestId: "first", text: response.body_text, state: { collapsed: true, overrides: new Set([5]) } };
        expect(resolveJsonFoldSnapshot(previous, response, "first", previous.text)).toBe(previous);
        for (const [nextResponse, requestId, text] of [
            [{ ...response }, "first", previous.text],
            [response, "second", previous.text],
            [response, "first", "{}"],
        ] as const) {
            const next = resolveJsonFoldSnapshot(previous, nextResponse, requestId, text);
            expect(next.state).toBe(expandedJson);
            expect(next).not.toBe(previous);
            expect(resolveJsonFoldSnapshot(next, response, "first", previous.text).state).toBe(expandedJson);
        }
    });
});
