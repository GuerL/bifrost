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

    it("supports bf.runtime.unset and bf.runtime.clear", () => {
        const result = runPreRequestScript({
            script: `
bf.runtime.set("one", "1");
bf.runtime.set("two", "2");
bf.runtime.unset("one");
bf.runtime.clear();
`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map(),
        });

        expect(result.error).toBeNull();
        expect(result.runtimeVariables).toEqual({});
        expect(result.environmentMutations).toEqual([]);
    });

    it("bf.runtime.unset removes runtime override and falls back to env", () => {
        const result = runPreRequestScript({
            script: `
bf.runtime.set("token", "from-runtime");
bf.runtime.unset("token");
bf.test("env fallback after runtime unset", () => {
  bf.expect(bf.runtime.get("token")).toBe(undefined);
  bf.expect(bf.env.get("token")).toBe("from-env");
});
`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map([["token", "from-env"]]),
        });

        expect(result.error).toBeNull();
        expect(result.runtimeVariables.token).toBeUndefined();
        expect(result.tests).toEqual([
            { name: "env fallback after runtime unset", status: "passed", error: null },
        ]);
    });

    it("bf.runtime.clear clears only runtime values in the active scope", () => {
        const result = runPreRequestScript({
            script: `
bf.runtime.set("token", "from-runtime");
bf.runtime.set("trace", "from-runtime");
bf.runtime.clear();
bf.test("env fallback after runtime clear", () => {
  bf.expect(bf.runtime.get("token")).toBe(undefined);
  bf.expect(bf.env.get("token")).toBe("from-env");
});
`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map([["token", "from-env"]]),
        });

        expect(result.error).toBeNull();
        expect(result.runtimeVariables).toEqual({});
        expect(result.tests).toEqual([
            { name: "env fallback after runtime clear", status: "passed", error: null },
        ]);
    });

    it("bf.env.unset keeps env mutation behavior for persistence", () => {
        const result = runPreRequestScript({
            script: `
bf.env.unset("token");
bf.test("env value is still readable until persistence is applied", () => {
  bf.expect(bf.env.get("token")).toBe("from-env");
});
`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map([["token", "from-env"]]),
        });

        expect(result.error).toBeNull();
        expect(result.runtimeVariables.token).toBeUndefined();
        expect(result.environmentMutations).toEqual([
            { type: "unset", key: "token" },
        ]);
        expect(result.tests).toEqual([
            {
                name: "env value is still readable until persistence is applied",
                status: "passed",
                error: null,
            },
        ]);
    });

    it("uses env value when no runtime override exists", () => {
        const result = runPreRequestScript({
            script: `
bf.test("env fallback", () => {
  bf.expect(bf.runtime.get("token")).toBe(undefined);
  bf.expect(bf.env.get("token")).toBe("from-env");
});
`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map([["token", "from-env"]]),
        });

        expect(result.error).toBeNull();
        expect(result.tests).toEqual([
            { name: "env fallback", status: "passed", error: null },
        ]);
    });

    it("runtime override is execution-scoped when caller starts a fresh scope", () => {
        const firstExecution = runPreRequestScript({
            script: `bf.runtime.set("token", "from-runtime");`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map([["token", "from-env"]]),
        });
        expect(firstExecution.runtimeVariables.token).toBe("from-runtime");

        const secondExecution = runPreRequestScript({
            script: `
bf.test("fresh scope uses env", () => {
  bf.expect(bf.runtime.get("token")).toBe(undefined);
  bf.expect(bf.env.get("token")).toBe("from-env");
});
`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map([["token", "from-env"]]),
        });

        expect(secondExecution.error).toBeNull();
        expect(secondExecution.tests).toEqual([
            { name: "fresh scope uses env", status: "passed", error: null },
        ]);
    });

    it("runner-style scope shares runtime variables across chained executions", () => {
        const firstRequest = runPreRequestScript({
            script: `bf.runtime.set("shared", "yes");`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map(),
        });

        const secondRequest = runPreRequestScript({
            script: `
bf.test("shared runtime", () => {
  bf.expect(bf.runtime.get("shared")).toBe("yes");
});
`,
            request: buildRequest(),
            runtimeVariables: firstRequest.runtimeVariables,
            environmentValues: new Map(),
        });

        expect(secondRequest.error).toBeNull();
        expect(secondRequest.tests).toEqual([
            { name: "shared runtime", status: "passed", error: null },
        ]);
    });

    it("runtime scope resets when a runner starts a new run", () => {
        const firstRunRequest = runPreRequestScript({
            script: `bf.runtime.set("shared", "yes");`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map([["shared", "from-env"]]),
        });
        expect(firstRunRequest.runtimeVariables.shared).toBe("yes");

        const secondRunRequest = runPreRequestScript({
            script: `
bf.test("new run uses fresh runtime scope", () => {
  bf.expect(bf.runtime.get("shared")).toBe(undefined);
  bf.expect(bf.env.get("shared")).toBe("from-env");
});
`,
            request: buildRequest(),
            runtimeVariables: {},
            environmentValues: new Map([["shared", "from-env"]]),
        });

        expect(secondRunRequest.error).toBeNull();
        expect(secondRunRequest.tests).toEqual([
            { name: "new run uses fresh runtime scope", status: "passed", error: null },
        ]);
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
