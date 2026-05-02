import { describe, expect, it } from "vitest";
import type { Request } from "../types.ts";
import {
    decidePgToBfPrompt,
    findLegacyPgScriptLocations,
    listRequestScriptFields,
    migrateRequestScriptsFromPgToBf,
    migrateScriptFromPgToBf,
    readPgToBfPromptedFlag,
    scriptContainsLegacyPgPrefix,
    writePgToBfPromptedFlag,
} from "./ScriptingPrefixMigration.ts";

function buildRequest({
    id,
    preRequest = "",
    postResponse = "",
}: {
    id: string;
    preRequest?: string;
    postResponse?: string;
}): Request {
    return {
        id,
        name: `Request ${id}`,
        method: "get",
        url: "https://example.com",
        headers: [],
        query: [],
        body: { type: "none" },
        auth: { type: "none" },
        extractors: [],
        scripts: {
            pre_request: preRequest,
            post_response: postResponse,
        },
    };
}

function createMemoryStorage() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
            store.set(key, value);
        },
        removeItem: (key: string) => {
            store.delete(key);
        },
    };
}

describe("Scripting prefix migration helpers", () => {
    it("detects pg. usage only in executable code", () => {
        const script = `
const text = "pg.environment.get(\\"apiKey\\")";
// pg.environment.set("x", "y")
const value = pg.environment.get("apiKey");
const templateText = \`pg.response.json()\`;
`;

        expect(scriptContainsLegacyPgPrefix(script)).toBe(true);
    });

    it("ignores pg. in comments and string/template literals", () => {
        const script = `
const text = "pg.environment.get(\\"apiKey\\")";
/* pg.environment.unset("apiKey") */
const templateText = \`pg.response.json()\`;
`;

        expect(scriptContainsLegacyPgPrefix(script)).toBe(false);
    });

    it("replaces safe pg. occurrences with bf. and preserves comments/strings", () => {
        const script = `
const text = "pg.environment.get(\\"apiKey\\")";
// pg.environment.set("x", "y")
const current = pg.environment.get("apiKey");
const templateText = \`pg.response.json()\`;
const templateExpr = \`\${pg.response.json()?.token ?? ""}\`;
`;

        const migrated = migrateScriptFromPgToBf(script);
        expect(migrated.changed).toBe(true);
        expect(migrated.script).toContain("const current = bf.environment.get(\"apiKey\");");
        expect(migrated.script).toContain("const templateExpr = `${bf.response.json()?.token ?? \"\"}`;");
        expect(migrated.script).toContain("\"pg.environment.get(\\\"apiKey\\\")\"");
        expect(migrated.script).toContain("// pg.environment.set(\"x\", \"y\")");
        expect(migrated.script).toContain("`pg.response.json()`");
    });

    it("leaves scripts without legacy prefix untouched", () => {
        const script = `
bf.environment.set("apiKey", "x");
bf.test("ok", () => {});
`;

        const migrated = migrateScriptFromPgToBf(script);
        expect(migrated.changed).toBe(false);
        expect(migrated.script).toBe(script);
    });

    it("finds legacy usage locations and migrates request scripts", () => {
        const requests = [
            buildRequest({
                id: "req_1",
                preRequest: `pg.environment.set("x", "1");`,
                postResponse: "",
            }),
            buildRequest({
                id: "req_2",
                preRequest: "",
                postResponse: `pg.test("status", () => { pg.expect(pg.response.statusCode).toBe(200); });`,
            }),
            buildRequest({
                id: "req_3",
                preRequest: `bf.environment.get("x");`,
                postResponse: "",
            }),
        ];

        const locations = findLegacyPgScriptLocations(requests);
        expect(locations).toEqual([
            { requestId: "req_1", scriptField: "pre_request" },
            { requestId: "req_2", scriptField: "post_response" },
        ]);

        const migrated = migrateRequestScriptsFromPgToBf(requests[0]);
        expect(migrated.changed).toBe(true);
        expect(migrated.request.scripts.pre_request).toContain("bf.environment.set");
    });

    it("uses real script fields currently stored by Bifrost (pre_request/post_response)", () => {
        const request = buildRequest({
            id: "req_real_fields",
            preRequest: "pg.environment.get(\"token\");",
            postResponse: "pg.response.json();",
        });
        expect(listRequestScriptFields(request)).toEqual(["pre_request", "post_response"]);
        const locations = findLegacyPgScriptLocations([request]);
        expect(locations).toEqual([
            { requestId: "req_real_fields", scriptField: "pre_request" },
            { requestId: "req_real_fields", scriptField: "post_response" },
        ]);
    });

    it("supports non-standard script field names when present", () => {
        const request = buildRequest({ id: "req_custom" });
        (request as unknown as { scripts: Record<string, string> }).scripts = {
            preRequest: "pg.environment.get(\"token\")",
            postResponse: "pg.response.json()",
        };

        const locations = findLegacyPgScriptLocations([request]);
        expect(locations).toEqual([
            { requestId: "req_custom", scriptField: "preRequest" },
            { requestId: "req_custom", scriptField: "postResponse" },
        ]);

        const migrated = migrateRequestScriptsFromPgToBf(request);
        expect(migrated.changed).toBe(true);
        expect((migrated.request.scripts as Record<string, string>).preRequest).toContain(
            "bf.environment.get"
        );
        expect((migrated.request.scripts as Record<string, string>).postResponse).toContain(
            "bf.response.json"
        );
    });

    it("requests prompt only when legacy scripts exist and flag is false", () => {
        expect(decidePgToBfPrompt({ promptedFlag: false, legacyScriptCount: 2 })).toEqual({
            shouldShowPrompt: true,
            reason: "legacy_scripts_detected",
        });
        expect(decidePgToBfPrompt({ promptedFlag: true, legacyScriptCount: 2 })).toEqual({
            shouldShowPrompt: false,
            reason: "already_prompted",
        });
        expect(decidePgToBfPrompt({ promptedFlag: false, legacyScriptCount: 0 })).toEqual({
            shouldShowPrompt: false,
            reason: "no_legacy_scripts",
        });
    });

    it("does not set prompt flag during detection or migration checks", () => {
        const storage = createMemoryStorage();
        const request = buildRequest({
            id: "req_flag_check",
            preRequest: `pg.environment.set("token", "x");`,
        });

        findLegacyPgScriptLocations([request]);
        migrateRequestScriptsFromPgToBf(request);

        expect(readPgToBfPromptedFlag(storage)).toBe(false);
    });

    it("keeps prompt flag unset when no legacy scripts exist", () => {
        const storage = createMemoryStorage();
        const request = buildRequest({
            id: "req_no_legacy",
            preRequest: `bf.environment.set("token", "x");`,
            postResponse: `bf.response.json();`,
        });

        const locations = findLegacyPgScriptLocations([request]);
        expect(locations).toEqual([]);
        expect(readPgToBfPromptedFlag(storage)).toBe(false);
    });

    it("persists migration prompt flag", () => {
        const storage = createMemoryStorage();

        expect(readPgToBfPromptedFlag(storage)).toBe(false);

        writePgToBfPromptedFlag(true, storage);
        expect(readPgToBfPromptedFlag(storage)).toBe(true);

        writePgToBfPromptedFlag(false, storage);
        expect(readPgToBfPromptedFlag(storage)).toBe(false);
    });
});
