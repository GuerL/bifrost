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

describe("RequestScriptsRuntime scripting prefix aliases", () => {
    it("supports bf as the primary scripting API prefix", () => {
        const result = runPreRequestScript({
            script: `
bf.environment.set("token", "abc123");
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
bf.environment.set("fromBf", "1");
pg.environment.set("fromPg", "2");
`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map(),
        });

        expect(result.error).toBeNull();
        expect(result.runtimeVariables).toMatchObject({
            fromBf: "1",
            fromPg: "2",
        });
    });
});
