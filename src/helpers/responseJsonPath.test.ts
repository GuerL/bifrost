import { describe, expect, it } from "vitest";
import { indexResponseJson, jsonPathFromSegments } from "./responseJsonPath.ts";

const fixture = (value: unknown) => {
    const text = JSON.stringify(value, null, 2);
    const index = indexResponseJson(text)!;
    expect(index).not.toBeNull();
    return { text, at: (token: string) => index.pathAt(text.indexOf(token)), index };
};

describe("response JSONPath", () => {
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
