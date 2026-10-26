import { describe, expect, it } from "vitest";
import { applyJsonDepth, jsonAdjustmentDepth, maximumJsonExpansionDepth, jsonDepthSelection, expandedJson, isJsonCollapsed, toggleJsonFold, visibleJsonContainers } from "./responseJsonFolding.ts";
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


describe("JSON depth presets", () => {
    it.each([
        { a: [{ b: { c: [1] } }], empty: {}, primitive: true },
        [[{ b: { c: [1] } }], [], null],
    ])("applies repeated presets using root-relative container depth: %j", value => {
        const { text, index } = fixture(value);
        for (const depth of [1, 2, 3, "all", 3, 1, "all", 2] as const) {
            const state = applyJsonDepth(depth);
            expect(jsonDepthSelection(state)).toBe(depth);
            for (const node of index.containers) {
                expect(isJsonCollapsed(state, node)).toBe(depth !== "all" && node.depth >= depth);
                expect(index.copyAt(node.valueStart)?.text).toBe(JSON.stringify(JSON.parse(text.slice(node.valueStart, node.end)), null, 2));
                expect(index.pathAt(node.start)).toBe(index.pathAt(node.valueStart));
            }
            const visible = visibleJsonContainers(index.containers, state);
            expect(visible.every(range => range.node.count > 0)).toBe(true);
            expect(visible.every(range => depth === "all" || range.node.depth <= depth)).toBe(true);
            expect(isJsonCollapsed(state, index.containers[0])).toBe(false);
        }
        expect(JSON.parse(text)).toEqual(value);
    });

    it("keeps child overrides stable and replaces manual changes on the next preset", () => {
        const { index } = fixture({ parent: { child: [1] }, sibling: [2] });
        const [, parent, child, sibling] = index.containers;
        let state = toggleJsonFold(applyJsonDepth(2), child);
        expect(jsonDepthSelection(state)).toBe("custom");
        state = toggleJsonFold(state, parent);
        state = toggleJsonFold(state, parent);
        expect(isJsonCollapsed(state, child)).toBe(false);
        expect(isJsonCollapsed(state, sibling)).toBe(false);
        expect(jsonDepthSelection(applyJsonDepth(1))).toBe(1);
        expect(isJsonCollapsed(applyJsonDepth(1), child)).toBe(true);
        expect(jsonDepthSelection(applyJsonDepth("all"))).toBe("all");
    });

    it.each([{}, [], null, 1, true, "text", { shallow: [1] }])("handles empty, primitive and shallow responses: %j", value => {
        const { index } = fixture(value);
        for (const depth of [1, 2, 3, "all"] as const) {
            const visible = visibleJsonContainers(index.containers, applyJsonDepth(depth));
            expect(visible.filter(range => range.node.count === 0)).toEqual([]);
            if (depth === 3 || depth === "all") expect(visible.every(range => !range.collapsed)).toBe(true);
        }
    });
});


describe("dynamic JSON expansion depth", () => {
    it.each([
        [null, 1], [42, 1], ["text", 1], [{}, 1], [[], 1],
        [{ value: 1, empty: {} }, 1], [[1, [], {}], 1],
        [{ child: { value: 1 } }, 2],
        [{ child: { empty: [] } }, 2],
        [[{ child: [1, {}] }], 3],
    ])("derives meaningful depth from nonempty containers: %j", (value, maximum) => {
        const { index } = fixture(value);
        expect(maximumJsonExpansionDepth(index.containers)).toBe(maximum);
        expect(visibleJsonContainers(index.containers, applyJsonDepth(maximum as number)).every(node => !node.collapsed)).toBe(true);
    });

    it("supports hundreds of levels with no preset ceiling and no extra leaf level", () => {
        let value: unknown = [1];
        for (let i = 0; i < 300; i++) value = i % 2 ? { child: value } : [value];
        const { index } = fixture(value);
        const maximum = maximumJsonExpansionDepth(index.containers);
        expect(maximum).toBe(301);
        for (const depth of [1, 11, 250, 300, 301]) {
            const state = applyJsonDepth(depth);
            expect(jsonDepthSelection(state)).toBe(depth);
            expect(visibleJsonContainers(index.containers, state).filter(node => node.collapsed)).toHaveLength(depth === maximum ? 0 : 1);
        }
    });

    it("retains the last explicit depth through Custom and All, and clamps adjustment to the response", () => {
        const { index } = fixture({ child: [{ value: 1 }] });
        let state = toggleJsonFold(applyJsonDepth(11), index.containers[0]);
        expect(jsonDepthSelection(state)).toBe("custom");
        expect(state.depth).toBe(11);
        expect(jsonAdjustmentDepth(state, 20)).toBe(11);
        expect(jsonAdjustmentDepth(state, 3)).toBe(3);
        state = applyJsonDepth("all", state);
        expect(jsonDepthSelection(state)).toBe("all");
        expect(jsonAdjustmentDepth(state, 20)).toBe(20);
        state = toggleJsonFold(state, index.containers[0]);
        expect(jsonDepthSelection(state)).toBe("custom");
        expect(jsonAdjustmentDepth(state, 20)).toBe(11);
        expect(jsonAdjustmentDepth({ collapsed: true, overrides: new Set() }, 20)).toBe(1);
    });
});
