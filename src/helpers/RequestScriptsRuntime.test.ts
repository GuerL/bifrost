import { describe, expect, it } from "vitest";
import type { Request } from "../types.ts";
import { runPostResponseScript, runPreRequestScript } from "./RequestScriptsRuntime.ts";

function buildRequest(): Request {
    return {
        id: "req_1",
        name: "Test request",
        method: "get",
        url: "https://example.com",
        headers: [],
        query: [],
        body: { type: "none" },
        auth: { type: "none" },
        extractors: [],
        scripts: { pre_request: "", post_response: "" },
    };
}

describe("RequestScriptsRuntime variable APIs and aliases", () => {
    it("supports bf.env as persistent environment API", () => {
        const result = runPreRequestScript({
            script: `
bf.env.set("token", "abc123");
bf.request.url = "https://api.example.com/me";
`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map(),
        });

        expect(result.error).toBeNull();
        expect(result.request.url).toBe("https://api.example.com/me");
        expect(result.runtimeVariables.token).toBe("abc123");
        expect(result.environmentMutations).toEqual([
            { type: "set", key: "token", value: "abc123" },
        ]);
    });

    it("supports bf.runtime as runtime-only variable API", () => {
        const result = runPreRequestScript({
            script: `
bf.runtime.set("temp", "42");
`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map([["temp", "from-env"]]),
        });

        expect(result.error).toBeNull();
        expect(result.runtimeVariables.temp).toBe("42");
        expect(result.environmentMutations).toEqual([]);
    });

    it("keeps bf.environment and bf.collectionVariables as backward-compatible aliases", () => {
        const result = runPreRequestScript({
            script: `
bf.environment.set("persisted", "1");
bf.collectionVariables.set("runtimeOnly", "2");
bf.globals.set("runtimeOnly2", "3");
`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map(),
        });

        expect(result.error).toBeNull();
        expect(result.runtimeVariables).toMatchObject({
            persisted: "1",
            runtimeOnly: "2",
            runtimeOnly2: "3",
        });
        expect(result.environmentMutations).toEqual([
            { type: "set", key: "persisted", value: "1" },
        ]);
    });

    it("keeps pg as a backward-compatible alias", () => {
        const result = runPostResponseScript({
            script: `
pg.test("reads response via pg alias", () => {
  const body = pg.response.json();
  pg.expect(body.ok).toBe(true);
  pg.expect(pg.response.headers.get("X-Test")).toBe("yes");
});
`,
            request: buildRequest(),
            response: {
                status: 200,
                headers: [{ key: "X-Test", value: "yes" }],
                body_text: JSON.stringify({ ok: true }),
                duration_ms: 20,
            },
            runtimeVariables: {},
            environmentValues: new Map(),
        });

        expect(result.error).toBeNull();
        expect(result.tests).toEqual([
            { name: "reads response via pg alias", status: "passed", error: null },
        ]);
    });

    it("allows bf and pg to be used together in the same script", () => {
        const result = runPreRequestScript({
            script: `
bf.env.set("fromBf", "1");
pg.env.set("fromPg", "2");
pg.runtime.set("temp", "3");
`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map(),
        });

        expect(result.error).toBeNull();
        expect(result.runtimeVariables).toMatchObject({
            fromBf: "1",
            fromPg: "2",
            temp: "3",
        });
        expect(result.environmentMutations).toEqual([
            { type: "set", key: "fromBf", value: "1" },
            { type: "set", key: "fromPg", value: "2" },
        ]);
    });
});
