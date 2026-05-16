import { describe, expect, it } from "vitest";
import type { Environment } from "../../types.ts";
import {
    buildEnvironmentExportPayload,
    buildEnvironmentExportVariables,
} from "./environmentExport.ts";
import {
    buildEnvironmentImportPlan,
    mergeEnvironmentVariables,
    parseEnvironmentImportJson,
} from "./environmentImport.ts";
import { isSensitiveVariable } from "./sensitiveVariableDetection.ts";

function environment(overrides: Partial<Environment>): Environment {
    return {
        id: "env_1",
        name: "Env",
        variables: [],
        ...overrides,
    };
}

describe("environment import/export", () => {
    it("builds export payload with selected variables only", () => {
        const env = environment({
            name: "Bruno import",
            variables: [
                { key: "apiUrl", value: "https://api.example.com" },
                { key: "token", value: "secret-token" },
                { key: "baseUrl", value: "https://base.example.com" },
            ],
        });

        const candidates = buildEnvironmentExportVariables(env);
        expect(candidates.find((entry) => entry.key === "apiUrl")?.selectedByDefault).toBe(true);
        expect(candidates.find((entry) => entry.key === "token")?.selectedByDefault).toBe(false);

        const selected = candidates
            .filter((entry) => entry.key !== "token")
            .map((entry) => ({ key: entry.key, value: entry.value }));

        const payload = buildEnvironmentExportPayload(env.name, selected);

        expect(payload).toEqual({
            type: "bifrost-environment",
            version: 1,
            environment: {
                name: "Bruno import",
                variables: {
                    apiUrl: "https://api.example.com",
                    baseUrl: "https://base.example.com",
                },
            },
        });
    });

    it("detects sensitive variables case-insensitively", () => {
        expect(isSensitiveVariable("token")).toBe(true);
        expect(isSensitiveVariable("ACCESS_TOKEN")).toBe(true);
        expect(isSensitiveVariable("X-Api-Key")).toBe(true);
        expect(isSensitiveVariable("authorizationHeader")).toBe(true);
        expect(isSensitiveVariable("apiUrl")).toBe(false);
    });

    it("parses import file preview metadata", () => {
        const parsed = parseEnvironmentImportJson(
            JSON.stringify({
                type: "bifrost-environment",
                version: 1,
                environment: {
                    name: "Bruno import",
                    variables: {
                        apiUrl: "https://api.example.com",
                        token: "abc",
                    },
                },
            })
        );

        expect(parsed.environment.name).toBe("Bruno import");
        expect(parsed.environment.variables).toEqual([
            { key: "apiUrl", value: "https://api.example.com", sensitive: false },
            { key: "token", value: "abc", sensitive: true },
        ]);
    });

    it("applies overwrite and skip variable conflict strategies", () => {
        const existing = [
            { key: "apiUrl", value: "https://old.example.com" },
            { key: "token", value: "old-token" },
        ];
        const imported = [
            { key: "apiUrl", value: "https://new.example.com" },
            { key: "newCreatedFamily", value: "7" },
        ];

        const overwrite = mergeEnvironmentVariables(existing, imported, "overwrite");
        expect(overwrite).toEqual([
            { key: "apiUrl", value: "https://new.example.com" },
            { key: "token", value: "old-token" },
            { key: "newCreatedFamily", value: "7" },
        ]);

        const skip = mergeEnvironmentVariables(existing, imported, "skip");
        expect(skip).toEqual([
            { key: "apiUrl", value: "https://old.example.com" },
            { key: "token", value: "old-token" },
            { key: "newCreatedFamily", value: "7" },
        ]);
    });

    it("rejects invalid JSON and malformed import structure", () => {
        expect(() => parseEnvironmentImportJson("not-json")).toThrow("Invalid JSON");
        expect(() =>
            parseEnvironmentImportJson(
                JSON.stringify({
                    type: "bifrost-environment",
                    version: 1,
                    environment: {
                        name: "Env",
                    },
                })
            )
        ).toThrow("Malformed structure");
    });

    it("handles duplicate environment names with merge or duplicate strategies", () => {
        const parsedImport = parseEnvironmentImportJson(
            JSON.stringify({
                type: "bifrost-environment",
                version: 1,
                environment: {
                    name: "Bruno import",
                    variables: {
                        apiUrl: "https://api.example.com",
                    },
                },
            })
        );

        const existingEnvironments: Environment[] = [
            {
                id: "existing_1",
                name: "Bruno import",
                variables: [{ key: "apiUrl", value: "https://old.example.com" }],
            },
            {
                id: "existing_2",
                name: "Bruno import Copy",
                variables: [],
            },
        ];

        const mergePlan = buildEnvironmentImportPlan({
            parsedImport,
            existingEnvironments,
            selectedVariableKeys: ["apiUrl"],
            environmentConflictStrategy: "merge",
            variableConflictStrategy: "overwrite",
        });

        expect(mergePlan.targetEnvironmentId).toBe("existing_1");
        expect(mergePlan.createsNewEnvironment).toBe(false);

        const duplicatePlan = buildEnvironmentImportPlan({
            parsedImport,
            existingEnvironments,
            selectedVariableKeys: ["apiUrl"],
            environmentConflictStrategy: "duplicate",
            variableConflictStrategy: "overwrite",
        });

        expect(duplicatePlan.targetEnvironmentId).toBeNull();
        expect(duplicatePlan.targetEnvironmentName).toBe("Bruno import Copy 2");
        expect(duplicatePlan.createsNewEnvironment).toBe(true);
    });

    it("does not import deselected variables", () => {
        const parsedImport = parseEnvironmentImportJson(
            JSON.stringify({
                type: "bifrost-environment",
                version: 1,
                environment: {
                    name: "Bruno import",
                    variables: {
                        apiUrl: "https://api.example.com",
                        token: "secret",
                        baseUrl: "https://base.example.com",
                    },
                },
            })
        );

        const plan = buildEnvironmentImportPlan({
            parsedImport,
            existingEnvironments: [],
            selectedVariableKeys: ["apiUrl"],
            environmentConflictStrategy: "merge",
            variableConflictStrategy: "overwrite",
        });

        expect(plan.variables).toEqual([{ key: "apiUrl", value: "https://api.example.com" }]);
    });

    it("renames duplicate variable keys when requested", () => {
        const merged = mergeEnvironmentVariables(
            [{ key: "token", value: "old" }],
            [{ key: "token", value: "new" }],
            "rename"
        );

        expect(merged).toEqual([
            { key: "token", value: "old" },
            { key: "token_imported", value: "new" },
        ]);
    });
});
