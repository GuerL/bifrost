import { describe, expect, it } from "vitest";
import { parseInsomniaV5Collection } from "./insomniaV5Parser.ts";
import { mapInsomniaV5ToBifrost } from "./insomniaV5ToBifrost.ts";

const VALID_INSOMNIA_V5_JSON = JSON.stringify({
    type: "collection.insomnia.rest/5.0",
    schema_version: "5.1",
    name: "Insomnia V5 Sample",
    meta: {
        id: "wrk_sample",
        created: 1740000000000,
        modified: 1740000000001,
    },
    collection: [
        {
            name: "Users",
            meta: { id: "fld_users" },
            headers: [
                { name: "X-Folder", value: "{{ _.folderHeader }}" },
            ],
            authentication: {
                type: "basic",
                username: "{{ _.user }}",
                password: "{{ _.pass }}",
            },
            scripts: {
                preRequest: "insomnia.environment.set('folder', '1');",
            },
            environment: {
                fromFolder: "1",
            },
            children: [
                {
                    name: "Get User",
                    method: "GET",
                    url: "https://api.example.com/users/:id",
                    pathParameters: [
                        { name: "id", value: "{{ _.userId }}" },
                    ],
                    parameters: [
                        { name: "expand", value: "roles", type: "query" },
                    ],
                    headers: [
                        { name: "X-Trace-Id", value: "{{traceId}}" },
                    ],
                    scripts: {
                        preRequest: "insomnia.environment.set('trace', 'abc');",
                    },
                },
                {
                    name: "Create User",
                    method: "POST",
                    url: "https://api.example.com/users",
                    headers: [
                        { name: "Content-Type", value: "application/json" },
                    ],
                    body: {
                        mimeType: "application/json",
                        text: "{\"name\":\"{{ _.name }}\",\"email\":\"{{ _.email }}\"}",
                    },
                    authentication: {
                        type: "bearer",
                        token: "{{ _.token }}",
                    },
                },
                {
                    name: "Update User",
                    method: "PATCH",
                    url: "https://api.example.com/users/{userId}",
                    pathParameters: [
                        { name: "userId", value: "42" },
                    ],
                    body: {
                        mimeType: "text/plain",
                        text: "hello {% prompt 'test', '', 'x' %}",
                    },
                    authentication: {},
                },
                {
                    name: "Submit Form",
                    method: "POST",
                    url: "https://api.example.com/forms",
                    body: {
                        mimeType: "application/x-www-form-urlencoded",
                        params: [
                            { name: "title", value: "Test" },
                            { name: "skip", value: "1", disabled: true },
                        ],
                    },
                },
                {
                    name: "Upload Avatar",
                    method: "POST",
                    url: "https://api.example.com/upload",
                    body: {
                        mimeType: "multipart/form-data",
                        params: [
                            { name: "file", type: "file", fileName: "/tmp/avatar.png" },
                            { name: "description", type: "text", value: "avatar {{ _.userId }}" },
                        ],
                    },
                },
                {
                    name: "Legacy Auth",
                    method: "GET",
                    url: "https://api.example.com/legacy",
                    authentication: {
                        type: "oauth1",
                        consumerKey: "abc",
                    },
                },
                {
                    name: "Binary Upload",
                    method: "POST",
                    url: "https://api.example.com/binary",
                    body: {
                        mimeType: "application/octet-stream",
                        fileName: "/tmp/binary.dat",
                    },
                },
                {
                    name: "gRPC Echo",
                    url: "grpc://localhost:50051",
                    reflectionApi: {
                        enabled: false,
                    },
                },
            ],
        },
    ],
});

function importInsomnia(fileText: string, fileName = "insomnia-export.yaml") {
    const parsed = parseInsomniaV5Collection(fileText);
    return mapInsomniaV5ToBifrost(parsed, fileName);
}

function requestByName(
    requests: ReturnType<typeof importInsomnia>["requests"],
    name: string
) {
    const match = requests.find((entry) => entry.request.name === name);
    expect(match).toBeTruthy();
    if (!match) {
        throw new Error(`Request not found: ${name}`);
    }
    return match;
}

describe("Insomnia V5 import", () => {
    it("detects a valid Insomnia V5 collection file", () => {
        const parsed = parseInsomniaV5Collection(VALID_INSOMNIA_V5_JSON);
        expect(parsed.type).toBe("collection.insomnia.rest/5.0");
        expect(parsed.schema_version).toBe("5.1");
    });

    it("detects a valid Insomnia V5 YAML collection file", () => {
        const yamlText = `
type: collection.insomnia.rest/5.0
schema_version: "5.1"
name: YAML Import
collection:
  - name: Ping
    method: GET
    url: https://example.com/ping
`;
        const parsed = parseInsomniaV5Collection(yamlText);
        expect(parsed.type).toBe("collection.insomnia.rest/5.0");
        expect(parsed.schema_version).toBe("5.1");
        expect(parsed.name).toBe("YAML Import");
    });

    it("maps collection name from workspace metadata with fallback to file name", () => {
        const named = importInsomnia(VALID_INSOMNIA_V5_JSON, "named-export.json");
        expect(named.collectionName).toBe("Insomnia V5 Sample");

        const withoutName = JSON.stringify({
            type: "collection.insomnia.rest/5.0",
            schema_version: "5.1",
            collection: [
                {
                    name: "Ping",
                    method: "GET",
                    url: "https://example.com/ping",
                },
            ],
        });
        const fallback = importInsomnia(withoutName, "my-insomnia-export.yaml");
        expect(fallback.collectionName).toBe("my-insomnia-export");
    });

    it("preserves folder hierarchy", () => {
        const plan = importInsomnia(VALID_INSOMNIA_V5_JSON);
        expect(requestByName(plan.requests, "Get User").folderPath).toEqual(["Users"]);
        expect(requestByName(plan.requests, "Upload Avatar").folderPath).toEqual(["Users"]);
    });

    it("maps request method and url", () => {
        const plan = importInsomnia(VALID_INSOMNIA_V5_JSON);
        const getUser = requestByName(plan.requests, "Get User").request;
        expect(getUser.method).toBe("get");
        expect(getUser.url).toBe("https://api.example.com/users/{{ _.userId }}");
    });

    it("maps headers including inherited folder headers", () => {
        const plan = importInsomnia(VALID_INSOMNIA_V5_JSON);
        const getUser = requestByName(plan.requests, "Get User").request;
        expect(getUser.headers).toEqual(
            expect.arrayContaining([
                { key: "X-Folder", value: "{{ _.folderHeader }}" },
                { key: "X-Trace-Id", value: "{{traceId}}" },
            ])
        );
    });

    it("maps query params", () => {
        const plan = importInsomnia(VALID_INSOMNIA_V5_JSON);
        const getUser = requestByName(plan.requests, "Get User").request;
        expect(getUser.query).toEqual(
            expect.arrayContaining([
                { key: "expand", value: "roles" },
            ])
        );
    });

    it("maps JSON body", () => {
        const plan = importInsomnia(VALID_INSOMNIA_V5_JSON);
        const createUser = requestByName(plan.requests, "Create User").request;
        expect(createUser.body.type).toBe("json");
        if (createUser.body.type !== "json") {
            throw new Error("Expected JSON body");
        }
        expect(createUser.body.value).toEqual({
            name: "{{ _.name }}",
            email: "{{ _.email }}",
        });
    });

    it("maps raw body", () => {
        const plan = importInsomnia(VALID_INSOMNIA_V5_JSON);
        const updateUser = requestByName(plan.requests, "Update User").request;
        expect(updateUser.body.type).toBe("raw");
        if (updateUser.body.type !== "raw") {
            throw new Error("Expected raw body");
        }
        expect(updateUser.body.content_type).toBe("text/plain");
        expect(updateUser.body.text).toContain("hello");
    });

    it("maps form body", () => {
        const plan = importInsomnia(VALID_INSOMNIA_V5_JSON);
        const submitForm = requestByName(plan.requests, "Submit Form").request;
        expect(submitForm.body.type).toBe("form");
        if (submitForm.body.type !== "form") {
            throw new Error("Expected form body");
        }
        expect(submitForm.body.fields).toEqual(
            expect.arrayContaining([{ key: "title", value: "Test" }])
        );
    });

    it("maps multipart body", () => {
        const plan = importInsomnia(VALID_INSOMNIA_V5_JSON);
        const upload = requestByName(plan.requests, "Upload Avatar").request;
        expect(upload.body.type).toBe("multipart");
        if (upload.body.type !== "multipart") {
            throw new Error("Expected multipart body");
        }
        expect(upload.body.fields).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: "file", name: "file", file_path: "/tmp/avatar.png" }),
                expect.objectContaining({ kind: "text", name: "description", value: "avatar {{ _.userId }}" }),
            ])
        );
    });

    it("preserves variables and inherited auth values", () => {
        const plan = importInsomnia(VALID_INSOMNIA_V5_JSON);
        const updateUser = requestByName(plan.requests, "Update User").request;
        expect(updateUser.url).toContain("42");
        expect(updateUser.auth.type).toBe("basic");
        if (updateUser.auth.type !== "basic") {
            throw new Error("Expected inherited basic auth");
        }
        expect(updateUser.auth.username).toBe("{{ _.user }}");
        expect(updateUser.auth.password).toBe("{{ _.pass }}");

        const createUser = requestByName(plan.requests, "Create User").request;
        expect(createUser.auth.type).toBe("bearer");
        if (createUser.auth.type !== "bearer") {
            throw new Error("Expected bearer auth");
        }
        expect(createUser.auth.token).toBe("{{ _.token }}");
    });

    it("adds warnings for unsupported body/auth/script/template syntax fields", () => {
        const plan = importInsomnia(VALID_INSOMNIA_V5_JSON);
        expect(
            plan.warnings.some((warning) =>
                warning.includes("Insomnia scripts were imported without modification")
            )
        ).toBe(true);
        expect(
            plan.warnings.some((warning) => warning.includes("unsupported auth type 'oauth1'"))
        ).toBe(true);
        expect(
            plan.warnings.some((warning) => warning.includes("unsupported binary/file body"))
        ).toBe(true);
        expect(
            plan.warnings.some((warning) =>
                warning.includes("template tags/variables were preserved as raw values")
            )
        ).toBe(true);
    });

    it("rejects invalid JSON/YAML", () => {
        expect(() => parseInsomniaV5Collection("{ not-valid")).toThrow(
            /Could not parse file as JSON or YAML/i
        );
    });

    it("rejects unsupported Insomnia versions and legacy formats", () => {
        expect(() =>
            parseInsomniaV5Collection(
                JSON.stringify({
                    type: "collection.insomnia.rest/5.0",
                    schema_version: "6.0",
                    collection: [],
                })
            )
        ).toThrow(/Unsupported Insomnia version/i);

        expect(() =>
            parseInsomniaV5Collection(
                JSON.stringify({
                    _type: "export",
                    __export_format: 4,
                    resources: [],
                })
            )
        ).toThrow(/Unsupported Insomnia version/i);
    });

    it("fails when no importable HTTP requests are found", () => {
        const noHttpRequests = JSON.stringify({
            type: "collection.insomnia.rest/5.0",
            schema_version: "5.1",
            name: "No HTTP",
            collection: [
                {
                    name: "gRPC only",
                    url: "grpc://localhost:50051",
                    reflectionApi: {
                        enabled: false,
                    },
                },
            ],
        });

        const parsed = parseInsomniaV5Collection(noHttpRequests);
        expect(() => mapInsomniaV5ToBifrost(parsed, "no-http.json")).toThrow(
            /No importable HTTP requests were found/i
        );
    });
});
