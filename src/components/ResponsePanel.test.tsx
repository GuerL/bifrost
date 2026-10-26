import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ResponsePanel from "./ResponsePanel.tsx";
import { expandedJson, toggleJsonFold, type JsonFoldState, type JsonFoldSnapshot } from "../helpers/responseJsonFolding.ts";
import { indexResponseJson } from "../helpers/responseJsonPath.ts";

// Seed the existing fold state for server-rendered coverage without adding viewer props.
const seededFolds = vi.hoisted(() => ({ state: null as JsonFoldState | null }));
vi.mock("react", async importOriginal => {
    const react = await importOriginal<typeof import("react")>();
    return { ...react, useState: ((initial: unknown) => {
        if (seededFolds.state && initial && typeof initial === "object" && "state" in initial && "response" in initial) {
            return react.useState({ ...initial as JsonFoldSnapshot, state: seededFolds.state });
        }
        return react.useState(initial);
    }) as typeof react.useState };
});
afterEach(() => { seededFolds.state = null; });

function render(body_text: string) {
    return renderToStaticMarkup(<ResponsePanel response={{ body_text, status: 200, headers: [], duration_ms: 1 }}
        statusText="OK" scriptReport={null} runtimeVariables={{}} onClearRuntimeVariables={() => {}}
        activeTab="body" onTabChange={() => {}} requestId="request" />);
}

describe("response JSON disclosure integration", () => {
    it.each([
        { body: { nested: { values: [1, 2] }, empty: {} }, path: "$.nested", preview: "{…}", count: "1 key", container: 1 },
        { body: { nested: { values: [1, 2] }, empty: [] }, path: "$.nested.values", preview: "[…]", count: "2 items", container: 2 },
        { body: { nested: [1] }, path: "$", preview: "{…}", count: "1 key", container: 0 },
        { body: [{ nested: [1] }, {}], path: "$", preview: "[…]", count: "2 items", container: 0 },
    ])("renders an accessible preview for $path at container $container", ({ body, path, preview, count, container }) => {
        const text = JSON.stringify(body);
        const node = indexResponseJson(JSON.stringify(body, null, 2))!.containers[container];
        seededFolds.state = toggleJsonFold(expandedJson, node);
        const html = render(text);
        const kind = preview === "[…]" ? "array" : "object";
        expect(html).toContain(`aria-label="Expand ${path}" aria-expanded="false"`);
        expect(html).toContain(`<button type="button" class="pg-json-fold-preview" aria-label="Expand ${kind} ${path}" aria-expanded="false" data-json-offset="${node.valueStart}" data-json-anchor="">${preview}</button>`);
        expect(html).toContain(`data-json-anchor=""> ${count}</span>`);
        expect(html.match(/class="pg-json-fold-preview"/g)).toHaveLength(1);
    });

    it("renders bulk collapse previews with counts outside buttons and restores expanded formatting", () => {
        const body = '{"object":{"value":1},"array":[1,2],"empty":{}}';
        seededFolds.state = { collapsed: true, overrides: new Set() };
        const html = render(body);
        expect(html.match(/class="pg-json-fold-preview"/g)).toHaveLength(2);
        expect(html).toContain('aria-label="Expand object $.object"');
        expect(html).toContain('aria-label="Expand array $.array"');
        expect(html).toContain('aria-label="Collapse $"');
        expect(html).not.toContain('aria-label="Expand object $.empty"');
        seededFolds.state = expandedJson;
        expect(render(body)).not.toContain('class="pg-json-fold-preview"');
    });

    it("renders semantic, labelled disclosure buttons with expanded state and original text offsets", () => {
        const html = render('{"user.name":[{"id":42}],"empty":{}}');
        expect(html).toContain('aria-label="Collapse $" aria-expanded="true"');
        expect(html).toContain('aria-label="Collapse $[&quot;user.name&quot;]" aria-expanded="true"');
        expect(html.match(/class="pg-json-disclosure"/g)).toHaveLength(3);
        expect(html).toContain('type="button"');
        expect(html).toContain('data-json-offset=');
        expect(html).toContain('Collapse All');
        expect(html).toContain('Expand All');
        expect(html).toContain('42');
    });

    it.each([
        { object: { nested: [{ value: 42 }, 7], primitive: true, empty: {} }, sibling: null },
        [{ nested: { value: 42 }, primitive: true }, [], 7],
    ])("preserves formatted lines and reserves a disclosure slot at every depth: %j", body => {
        const formatted = JSON.stringify(body, null, 2);
        const html = render(JSON.stringify(body));
        const rows = [...html.matchAll(/<span class="pg-json-row">([\s\S]*?)(?=<span class="pg-json-row">|<\/pre>)/g)];
        expect(rows).toHaveLength(formatted.split("\n").length);
        expect(html.match(/class="pg-json-disclosure-slot"/g)).toHaveLength(rows.length);
        const visibleText = rows.map(([, row]) => row
            .replace(/<button[\s\S]*?<\/button>/g, "")
            .replace(/<[^>]*>/g, "")
            .replace(/&quot;/g, '\"'))
            .join("");
        expect(visibleText).toBe(formatted);
        for (const [index, [, row]] of rows.entries()) {
            const indent = formatted.split("\n")[index].match(/^ */)![0];
            const indentHtml = row.match(/<span class="pg-json-indent">([\s\S]*?)<\/span>/)![1];
            expect(indentHtml.replace(/<[^>]*>/g, "")).toBe(indent);
        }
    });

    it.each(['{}', '[]', 'null', '42', '"hello"', '{invalid', '<html>hello</html>'])("keeps empty, primitive, invalid and non-JSON responses readable: %s", body => {
        const html = render(body);
        expect(html).not.toContain('class="pg-json-disclosure"');
        expect(html).not.toContain('Collapse All');
        expect(html).toContain('aria-label="Response body"');
    });
});
