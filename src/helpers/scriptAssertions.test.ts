import { describe, expect, it } from "vitest";
import {
    createScriptAssertableValue,
    createScriptExpect,
    createScriptTestCollector,
    stringifyScriptError,
} from "./scriptAssertions.ts";

describe("scriptAssertions", () => {
    it("supports toBe", () => {
        expect(() => createScriptExpect(200).toBe(200)).not.toThrow();
        expect(() => createScriptExpect(200).toBe(201)).toThrow(
            'Expected 200 to be 201'
        );
    });

    it("supports toEqual", () => {
        expect(() =>
            createScriptExpect({ user: { id: 1, tags: ["a", "b"] } }).toEqual({
                user: { id: 1, tags: ["a", "b"] },
            })
        ).not.toThrow();

        expect(() =>
            createScriptExpect({ user: { id: 1 } }).toEqual({ user: { id: 2 } })
        ).toThrow('Expected {"user":{"id":1}} to equal {"user":{"id":2}}');
    });

    it("supports toContain for strings", () => {
        expect(() => createScriptExpect("bifrost").toContain("fro")).not.toThrow();
        expect(() => createScriptExpect("bifrost").toContain("zzz")).toThrow(
            'Expected "bifrost" to contain "zzz"'
        );
    });

    it("supports toContain for arrays", () => {
        expect(() => createScriptExpect([1, 2, 3]).toContain(2)).not.toThrow();
        expect(() =>
            createScriptExpect([{ id: 1 }, { id: 2 }]).toContain({ id: 2 })
        ).not.toThrow();
        expect(() => createScriptExpect([1, 2, 3]).toContain(4)).toThrow(
            "Expected [1,2,3] to contain 4"
        );
    });

    it("supports toBeDefined", () => {
        expect(() => createScriptExpect("value").toBeDefined()).not.toThrow();
        expect(() => createScriptExpect(undefined).toBeDefined()).toThrow(
            "Expected value to be defined"
        );
    });

    it("supports toBeTruthy", () => {
        expect(() => createScriptExpect("x").toBeTruthy()).not.toThrow();
        expect(() => createScriptExpect(0).toBeTruthy()).toThrow(
            "Expected 0 to be truthy"
        );
    });

    it("supports toBeFalsy", () => {
        expect(() => createScriptExpect(0).toBeFalsy()).not.toThrow();
        expect(() => createScriptExpect("x").toBeFalsy()).toThrow(
            'Expected "x" to be falsy'
        );
    });

    it("supports not.toBe and not.toEqual", () => {
        expect(() => createScriptExpect(200).not.toBe(201)).not.toThrow();
        expect(() => createScriptExpect(200).not.toBe(200)).toThrow(
            "Expected 200 not to be 200"
        );

        expect(() =>
            createScriptExpect({ ok: true }).not.toEqual({ ok: false })
        ).not.toThrow();
        expect(() =>
            createScriptExpect({ ok: true }).not.toEqual({ ok: true })
        ).toThrow('Expected {"ok":true} not to equal {"ok":true}');
    });

    it("unwraps bifrost assertable values", () => {
        const assertableStatus = createScriptAssertableValue(200);

        expect(() => createScriptExpect(assertableStatus).toBe(200)).not.toThrow();
        expect(() => createScriptExpect(assertableStatus).toEqual(200)).not.toThrow();
        expect(() => assertableStatus.toBe(200)).not.toThrow();
    });
});

describe("createScriptTestCollector", () => {
    it("records passing and failing tests without stopping", () => {
        const collector = createScriptTestCollector();

        collector.test("passes", () => {
            createScriptExpect(1).toBe(1);
        });
        collector.test("fails", () => {
            createScriptExpect(1).toBe(2);
        });
        collector.test("runs after failure", () => {
            createScriptExpect(true).toBeTruthy();
        });

        const tests = collector.getResults();
        expect(tests).toHaveLength(3);
        expect(tests[0]).toMatchObject({ name: "passes", status: "passed", error: null });
        expect(tests[1]).toMatchObject({
            name: "fails",
            status: "failed",
            error: "Expected 1 to be 2",
        });
        expect(tests[2]).toMatchObject({ name: "runs after failure", status: "passed", error: null });
    });

    it("records readable error when callback is invalid", () => {
        const collector = createScriptTestCollector();
        collector.test("bad callback", null as unknown as () => void);

        expect(collector.getResults()[0]).toMatchObject({
            name: "bad callback",
            status: "failed",
            error: "bf.test(name, callback): callback must be a function",
        });
    });
});

describe("stringifyScriptError", () => {
    it("stringifies errors and primitives", () => {
        expect(stringifyScriptError(new Error("boom"))).toBe("boom");
        expect(stringifyScriptError("raw")).toBe("raw");
        expect(stringifyScriptError(12)).toBe("12");
    });
});
