import { describe, expect, it } from "vitest";
import { bifrostExpressionFromSegments, indexResponseJson, jsonPathFromSegments } from "./responseJsonPath.ts";

import { runPostResponseScript } from "./RequestScriptsRuntime.ts";
import type { Request } from "../types.ts";

const fixture = (value: unknown) => {
    const text = JSON.stringify(value, null, 2);
    const index = indexResponseJson(text)!;
    expect(index).not.toBeNull();
    return { text, at: (token: string) => index.pathAt(text.indexOf(token)), index };
};

describe("response JSONPath", () => {
    it.each(["", "Quentin", 'escaped\n\t"\\', "é🦄漢字", 42, -12.5, 1e25, true, false, null])("copies primitive values without their property keys: %j", value => {
        const { text, index } = fixture({ selected: value, sibling: 7 });
        const expected = typeof value === "string" ? value : JSON.stringify(value);
        for (const offset of [text.indexOf('"selected"'), text.indexOf(JSON.stringify(value))]) {
            expect(index.copyAt(offset)).toEqual({ text: expected, container: false });
            expect(index.pathAt(offset)).toBe("$.selected");
        }
    });

    it.each([{}, [], { nested: [{ value: "a" }, null, true, 3], empty: {} }, [{ child: [1, 2] }, []]].map(value => ({ value })))("copies full formatted containers at keys and closing delimiters: $value", ({ value }) => {
        const { text, index } = fixture({ selected: value, sibling: "other" });
        const node = index.containers.find(node => index.pathAt(node.start) === "$.selected")!;
        for (const offset of [node.start, node.valueStart, node.end - 1]) {
            expect(index.copyAt(offset)).toEqual({ text: JSON.stringify(value, null, 2), container: true });
            expect(index.pathAt(offset)).toBe("$.selected");
        }
        expect(index.copyAt(text.indexOf('"other"'))).toEqual({ text: "other", container: false });
    });

    it.each([null, "", "root", 1, false, {}, [], [1, { a: true }]].map(value => ({ value })))("copies root values: $value", ({ value }) => {
        const { index } = fixture(value);
        expect(index.copyAt(0)).toEqual({ text: typeof value === "string" ? value : JSON.stringify(value, null, 2), container: value !== null && typeof value === "object" });
    });

    it("uses exact special-key targets, including __proto__, and rejects invalid offsets", () => {
        const body = JSON.parse('{"__proto__":{"value":1},"a.b":["one","two"],"a [\\\"b\\\"]":false}');
        const { text, index } = fixture(body);
        expect(index.copyAt(text.indexOf('"__proto__"'))?.text).toBe('{\n  "value": 1\n}');
        expect(index.copyAt(text.indexOf('"two"'))?.text).toBe("two");
        expect(index.pathAt(text.indexOf('"two"'))).toBe('$["a.b"][1]');
        expect(index.copyAt(text.indexOf('false'))?.text).toBe("false");
        for (const offset of [-1, text.length, NaN, 0.5]) expect(index.copyAt(offset)).toBeNull();
    });

    it("copies large subtrees independently of their visible fold state", () => {
        const value = Array.from({ length: 10000 }, (_, i) => ({ i, text: "value" }));
        const { text, index } = fixture({ items: value });
        expect(index.copyAt(text.indexOf('"items"'))?.text).toBe(JSON.stringify(value, null, 2));
    });

    it("uses the viewer's canonical parsed representation for duplicate keys", () => {
        const value = JSON.parse('{"key":1,"key":2}');
        const { index } = fixture(value);
        expect(index.copyAt(0)?.text).toBe('{\n  "key": 2\n}');
    });

    it("formats identifiers, numeric indices, and JSON-escaped special keys", () => {
        expect(jsonPathFromSegments(["users", 0, "roles", 1])).toBe("$.users[0].roles[1]");
        for (const key of ["first name", "user.name", "special-key", "123field", 'a"b', "a\\b", "", "line\nfeed", "é", "[0]"]) {
            expect(jsonPathFromSegments([key])).toBe(`$[${JSON.stringify(key)}]`);
        }
        expect(jsonPathFromSegments([])).toBe("$");
    });

    it("resolves keys and their values to the exact property, including array objects", () => {
        const { at, text, index } = fixture({ users: [{ id: 42, email: "quentin@example.com", roles: ["ADMIN", "USER"] }], success: true });
        expect(at('"users"')).toBe("$.users");
        expect(at('"id"')).toBe("$.users[0].id");
        expect(at("42")).toBe("$.users[0].id");
        expect(at('"email"')).toBe("$.users[0].email");
        expect(at('"quentin@example.com"')).toBe("$.users[0].email");
        expect(at('"roles"')).toBe("$.users[0].roles");
        expect(at('"ADMIN"')).toBe("$.users[0].roles[0]");
        expect(at('"USER"')).toBe("$.users[0].roles[1]");
        expect(at("true")).toBe("$.success");
        expect(index.pathAt(text.indexOf("{", 1))).toBe("$.users[0]");
        expect(index.pathAt(0)).toBe("$");
        expect(index.pathAt(text.length - 1)).toBe("$");
    });

    it("handles arrays of arrays, empty containers, null, booleans, and numbers", () => {
        const { at } = fixture([[{}, [], null, false, -12.5], ["second"]]);
        expect(at("{}")).toBe("$[0][0]");
        expect(at("[]")).toBe("$[0][1]");
        expect(at("null")).toBe("$[0][2]");
        expect(at("false")).toBe("$[0][3]");
        expect(at("-12.5")).toBe("$[0][4]");
        expect(at('"second"')).toBe("$[1][0]");
    });

    it.each([{}, [], null, true, false, 42, "root"])("resolves primitive and empty roots: %j", value => {
        const { index, text } = fixture(value);
        for (let i = 0; i < text.length; i++) expect(index.pathAt(i)).toBe("$");
    });

    it.each(["first name", "user.name", "special-key", "123field", 'a"b', "a\\b", "\t", ""])("resolves special key and value: %j", key => {
        const { at } = fixture({ [key]: "value" });
        expect(at(JSON.stringify(key))).toBe(`$[${JSON.stringify(key)}]`);
        expect(at('"value"')).toBe(`$[${JSON.stringify(key)}]`);
    });

    it("distinguishes identical keys and values at different locations", () => {
        const { text, index } = fixture({ left: { id: 42 }, right: [{ id: 42 }] });
        expect(index.pathAt(text.indexOf('"id"'))).toBe("$.left.id");
        expect(index.pathAt(text.lastIndexOf('"id"'))).toBe("$.right[0].id");
        expect(index.pathAt(text.lastIndexOf("42"))).toBe("$.right[0].id");
    });

    it("resolves deep nodes and container closing delimiters", () => {
        let value: unknown = "leaf";
        const segments: (string | number)[] = [];
        for (let i = 0; i < 100; i++) {
            value = { nested: [value] };
            segments.push("nested", 0);
        }
        const { at } = fixture(value);
        expect(at('"leaf"')).toBe(jsonPathFromSegments(segments));
        const containers = fixture({ one: { child: [] }, two: {} });
        expect(containers.index.pathAt(containers.text.indexOf("}", 1))).toBe("$.one");
    });

    it.each(["", "undefined", "{", '{"a":}', "[1,]", '{"a":1} trailing', "<html/>", "plain text"])("rejects invalid JSON: %j", text => {
        expect(indexResponseJson(text)).toBeNull();
    });

    it("fails closed for noncanonical text and out-of-range positions", () => {
        expect(indexResponseJson('{"a":1}')).toBeNull();
        const { index, text } = fixture({ a: 1 });
        for (const offset of [-1, text.length, 0.5, NaN, Infinity]) expect(index.pathAt(offset)).toBeNull();
    });

    it("indexes a large response once and resolves nodes repeatedly", () => {
        const { text, index } = fixture(Array.from({ length: 10000 }, (_, id) => ({ id })));
        const offset = text.indexOf("9999");
        for (let i = 0; i < 100; i++) expect(index.pathAt(offset)).toBe("$[9999].id");
    });
});


describe("Bifrost response expressions", () => {
    const cases: { segments: (string | number)[]; expression: string }[] = [
        { segments: [], expression: 'bf.response.json()' },
        { segments: ['accessToken'], expression: 'bf.response.json().accessToken' },
        { segments: ['user', 'name'], expression: 'bf.response.json().user.name' },
        { segments: ['users', 0], expression: 'bf.response.json().users[0]' },
        { segments: ['users', 0, 'email'], expression: 'bf.response.json().users[0].email' },
        { segments: ['roles', 1], expression: 'bf.response.json().roles[1]' },
        { segments: ['matrix', 0, 1, 0], expression: 'bf.response.json().matrix[0][1][0]' },
        ...['user-name', 'first name', 'user.name', '123field', 'a"b', 'a\\b', '', 'line\nfeed', 'é', 'a"];throw Error("injection");//'].map(key => ({
            segments: [key], expression: `bf.response.json()[${JSON.stringify(key)}]`,
        })),
    ];

    it.each(cases)("generates $expression and executes it in a Post-response script", ({ segments, expression }) => {
        const selected = { token: 'abc123' };
        const body = segments.reduceRight<unknown>((child, segment) => typeof segment === 'number'
            ? Array.from({ length: segment + 1 }, (_, index) => index === segment ? child : null)
            : { [segment]: child }, selected);
        const { text, index } = fixture(body);
        const resolved = index.segmentsAt(text.indexOf(JSON.stringify('token')))!;
        // The selected object is the parent of its 'token' property.
        resolved.pop();
        expect(resolved).toEqual(segments);
        expect(bifrostExpressionFromSegments(resolved)).toBe(expression);
        expect(jsonPathFromSegments([...resolved, 'token'])).toBe(index.pathAt(text.indexOf(JSON.stringify('token'))));
        const request: Request = {
            id: 'test', name: 'Test', method: 'get', url: 'https://example.com',
            headers: [], query: [], body: { type: 'none' }, auth: { type: 'none' },
            extractors: [], scripts: { pre_request: '', post_response: '' },
        };
        const result = runPostResponseScript({
            script: `bf.env.set("picked", JSON.stringify(${expression}));`,
            request, response: { status: 200, headers: [], body_text: text, duration_ms: 1 },
            runtimeVariables: {}, environmentValues: new Map(),
        });
        expect(result.scriptError).toBeNull();
        expect(result.environmentMutations).toEqual([{ type: 'set', key: 'picked', value: JSON.stringify(selected) }]);
    });

    it.each([null, true, false, 42, 'value', {}, []])("handles primitive and empty-container selections: %j", value => {
        const { text, index } = fixture({ nested: [value] });
        const start = text.indexOf(JSON.stringify(value, null, 2));
        const segments = index.segmentsAt(start)!;
        expect(segments).toEqual(['nested', 0]);
        const expression = bifrostExpressionFromSegments(segments);
        expect(expression).toBe('bf.response.json().nested[0]');
        expect(new Function('bf', `return ${expression}`)({ response: { json: () => JSON.parse(text) } })).toEqual(value);
        expect(bifrostExpressionFromSegments([])).toBe('bf.response.json()');
    });

    it("uses the same deeply nested node as JSONPath and rejects invalid offsets", () => {
        let value: unknown = 'leaf';
        for (let depth = 0; depth < 100; depth++) value = { child: [value] };
        const { text, index } = fixture(value);
        const segments = index.segmentsAt(text.indexOf('"leaf"'))!;
        const expression = bifrostExpressionFromSegments(segments);
        expect(expression).toBe('bf.response.json()' + '.child[0]'.repeat(100));
        expect(new Function('bf', `return ${expression}`)({ response: { json: () => JSON.parse(text) } })).toBe('leaf');
        expect(index.pathAt(text.indexOf('"leaf"'))).toBe('$' + '.child[0]'.repeat(100));
        expect(index.segmentsAt(-1)).toBeNull();
        expect(index.segmentsAt(text.length)).toBeNull();
    });
});
