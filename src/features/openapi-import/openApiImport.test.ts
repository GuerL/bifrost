import { describe, expect, it } from "vitest";
import { parseOpenApiSpec } from "./openApiParser.ts";
import { mapOpenApiToBifrost } from "./openApiToBifrost.ts";

function importSpec(specText: string, fileName = "spec.json") {
    const parsed = parseOpenApiSpec(specText);
    return mapOpenApiToBifrost(parsed, fileName);
}

function requestByName(
    requests: ReturnType<typeof importSpec>["requests"],
    name: string
) {
    const request = requests.find((entry) => entry.request.name === name);
    expect(request).toBeTruthy();
    if (!request) {
        throw new Error(`Request not found: ${name}`);
    }
    return request.request;
}

describe("OpenAPI import mapping", () => {
    it("maps OpenAPI 3 JSON to requests with tags, query params, path placeholders and JSON body", () => {
        const jsonSpec = JSON.stringify({
            openapi: "3.0.3",
            info: { title: "Petstore API", version: "1.0.0" },
            servers: [{ url: "https://api.example.com/v1" }],
            paths: {
                "/pets/{petId}": {
                    parameters: [
                        { name: "petId", in: "path", required: true, schema: { type: "string" } },
                    ],
                    get: {
                        tags: ["Pets"],
                        operationId: "getPet",
                        parameters: [
                            { name: "include", in: "query", schema: { type: "string", default: "details" } },
                        ],
                        responses: {
                            "200": {
                                description: "ok",
                                content: {
                                    "application/json": {},
                                },
                            },
                        },
                    },
                    post: {
                        tags: ["Pets"],
                        summary: "Create pet",
                        requestBody: {
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            name: { type: "string" },
                                        },
                                    },
                                },
                            },
                        },
                        responses: {
                            "201": {
                                description: "created",
                                content: {
                                    "application/json": {},
                                },
                            },
                        },
                    },
                },
            },
        });

        const plan = importSpec(jsonSpec, "petstore.json");

        expect(plan.specKind).toBe("openapi3");
        expect(plan.collectionName).toBe("Petstore API (1.0.0)");
        expect(plan.grouping).toBe("tags");
        expect(plan.preview.serverUrl).toBe("https://api.example.com/v1");
        expect(plan.preview.pathCount).toBe(1);
        expect(plan.preview.requestCount).toBe(2);

        const getPet = requestByName(plan.requests, "getPet");
        expect(getPet.method).toBe("get");
        expect(getPet.url).toBe("https://api.example.com/v1/pets/{{petId}}");
        expect(getPet.query).toContainEqual({ key: "include", value: "details" });

        const createPet = requestByName(plan.requests, "Create pet");
        expect(createPet.method).toBe("post");
        expect(createPet.body.type).toBe("json");
        if (createPet.body.type !== "json") {
            throw new Error("Expected json body");
        }
        expect(createPet.body.value).toEqual({ name: "string" });
        expect(createPet.headers).toEqual(
            expect.arrayContaining([
                { key: "Content-Type", value: "application/json" },
                { key: "Accept", value: "application/json" },
            ])
        );
    });

    it("parses OpenAPI 3 YAML and maps application/x-www-form-urlencoded body", () => {
        const yamlSpec = `
openapi: 3.0.0
info:
  title: Auth API
  version: 2.1.0
servers:
  - url: https://auth.example.com
paths:
  /oauth/token:
    post:
      summary: Create token
      requestBody:
        content:
          application/x-www-form-urlencoded:
            schema:
              type: object
              properties:
                grant_type:
                  type: string
                  default: client_credentials
                scope:
                  type: string
      responses:
        "200":
          description: OK
`;

        const plan = importSpec(yamlSpec, "auth.yaml");
        const tokenRequest = requestByName(plan.requests, "Create token");

        expect(tokenRequest.body.type).toBe("form");
        if (tokenRequest.body.type !== "form") {
            throw new Error("Expected form body");
        }
        expect(tokenRequest.body.fields).toEqual(
            expect.arrayContaining([
                { key: "grant_type", value: "client_credentials" },
                { key: "scope", value: "string" },
            ])
        );
    });

    it("maps multipart/form-data schema to multipart rows", () => {
        const spec = JSON.stringify({
            openapi: "3.0.2",
            info: { title: "Upload API", version: "1.0.0" },
            paths: {
                "/upload": {
                    post: {
                        requestBody: {
                            content: {
                                "multipart/form-data": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            description: { type: "string", default: "hello" },
                                            file: { type: "string", format: "binary" },
                                        },
                                    },
                                },
                            },
                        },
                        responses: {
                            "200": { description: "ok" },
                        },
                    },
                },
            },
        });

        const plan = importSpec(spec, "upload.json");
        const uploadRequest = requestByName(plan.requests, "POST /upload");

        expect(uploadRequest.body.type).toBe("multipart");
        if (uploadRequest.body.type !== "multipart") {
            throw new Error("Expected multipart body");
        }
        expect(uploadRequest.body.fields).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: "text", name: "description", value: "hello" }),
                expect.objectContaining({ kind: "file", name: "file" }),
            ])
        );
    });

    it("falls back to first path segment grouping when tags are absent", () => {
        const spec = JSON.stringify({
            openapi: "3.0.3",
            info: { title: "Users API", version: "0.1.0" },
            paths: {
                "/users": {
                    get: {
                        operationId: "listUsers",
                        responses: { "200": { description: "ok" } },
                    },
                },
                "/users/{id}": {
                    get: {
                        summary: "Get user",
                        responses: { "200": { description: "ok" } },
                    },
                },
            },
        });

        const plan = importSpec(spec, "users.json");
        expect(plan.grouping).toBe("path_segment");
        expect(plan.requests.every((entry) => entry.folderName === "users")).toBe(true);
    });

    it("resolves local refs for parameters and request schemas", () => {
        const spec = JSON.stringify({
            openapi: "3.1.0",
            info: { title: "Ref API", version: "1.2.3" },
            paths: {
                "/items": {
                    get: {
                        parameters: [{ $ref: "#/components/parameters/LimitParam" }],
                        responses: { "200": { description: "ok" } },
                    },
                    post: {
                        requestBody: {
                            content: {
                                "application/json": {
                                    schema: { $ref: "#/components/schemas/NewItem" },
                                },
                            },
                        },
                        responses: { "201": { description: "ok" } },
                    },
                },
            },
            components: {
                parameters: {
                    LimitParam: {
                        name: "limit",
                        in: "query",
                        schema: { type: "integer", default: 25 },
                    },
                },
                schemas: {
                    NewItem: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            meta: { $ref: "#/components/schemas/Meta" },
                        },
                    },
                    Meta: {
                        type: "object",
                        properties: {
                            enabled: { type: "boolean" },
                        },
                    },
                },
            },
        });

        const plan = importSpec(spec, "refs.json");
        const listRequest = requestByName(plan.requests, "GET /items");
        expect(listRequest.query).toContainEqual({ key: "limit", value: "25" });

        const createRequest = requestByName(plan.requests, "POST /items");
        expect(createRequest.body.type).toBe("json");
        if (createRequest.body.type !== "json") {
            throw new Error("Expected json body");
        }
        expect(createRequest.body.value).toEqual({
            name: "string",
            meta: { enabled: true },
        });
    });

    it("imports Swagger 2.0 with query, body, and multipart form mapping", () => {
        const swaggerSpec = JSON.stringify({
            swagger: "2.0",
            info: { title: "Swagger Petstore", version: "2.0.0" },
            schemes: ["https"],
            host: "api.swagger.example",
            basePath: "/v2",
            consumes: ["application/json"],
            paths: {
                "/pets": {
                    get: {
                        parameters: [
                            { name: "status", in: "query", type: "string", default: "available" },
                        ],
                        responses: { "200": { description: "ok" } },
                    },
                    post: {
                        parameters: [
                            {
                                name: "body",
                                in: "body",
                                schema: { $ref: "#/definitions/NewPet" },
                            },
                        ],
                        responses: { "201": { description: "created" } },
                    },
                },
                "/upload": {
                    post: {
                        consumes: ["multipart/form-data"],
                        parameters: [
                            { name: "description", in: "formData", type: "string" },
                            { name: "file", in: "formData", type: "file" },
                        ],
                        responses: { "200": { description: "ok" } },
                    },
                },
            },
            definitions: {
                NewPet: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        age: { type: "integer" },
                    },
                },
            },
        });

        const plan = importSpec(swaggerSpec, "swagger.json");
        expect(plan.specKind).toBe("swagger2");
        expect(plan.preview.serverUrl).toBe("https://api.swagger.example/v2");

        const listPets = requestByName(plan.requests, "GET /pets");
        expect(listPets.url).toBe("https://api.swagger.example/v2/pets");
        expect(listPets.query).toContainEqual({ key: "status", value: "available" });

        const createPet = requestByName(plan.requests, "POST /pets");
        expect(createPet.body.type).toBe("json");
        if (createPet.body.type !== "json") {
            throw new Error("Expected json body");
        }
        expect(createPet.body.value).toEqual({ name: "string", age: 0 });

        const upload = requestByName(plan.requests, "POST /upload");
        expect(upload.body.type).toBe("multipart");
        if (upload.body.type !== "multipart") {
            throw new Error("Expected multipart body");
        }
        expect(upload.body.fields).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: "text", name: "description" }),
                expect.objectContaining({ kind: "file", name: "file" }),
            ])
        );
    });

    it("adds auth placeholders from security schemes", () => {
        const spec = JSON.stringify({
            openapi: "3.0.1",
            info: { title: "Secure API", version: "1.0.0" },
            security: [{ bearerAuth: [] }],
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: "http",
                        scheme: "bearer",
                    },
                },
            },
            paths: {
                "/secure": {
                    get: {
                        responses: { "200": { description: "ok" } },
                    },
                },
            },
        });

        const plan = importSpec(spec, "secure.json");
        const request = requestByName(plan.requests, "GET /secure");
        expect(request.headers).toContainEqual({
            key: "Authorization",
            value: "Bearer {{token}}",
        });
    });
});

describe("OpenAPI parser validation", () => {
    it("rejects invalid specs", () => {
        expect(() => parseOpenApiSpec("not: [valid")).toThrow();
        expect(() => parseOpenApiSpec("{}")).toThrow(/Missing 'openapi' or 'swagger' field/i);
        expect(() =>
            parseOpenApiSpec(JSON.stringify({ openapi: "2.0.0", paths: { "/x": {} } }))
        ).toThrow(/Unsupported OpenAPI version/i);
        expect(() =>
            parseOpenApiSpec(JSON.stringify({ openapi: "3.0.0", paths: {} }))
        ).toThrow(/empty paths/i);
    });
});

describe("OpenAPI external path ref handling", () => {
    it("marks all external path refs as skipped and produces zero importable operations", () => {
        const spec = JSON.stringify({
            openapi: "3.1.0",
            info: { title: "External Paths API", version: "1.0.0" },
            paths: {
                "/users/{username}": { $ref: "paths/users_{username}.yaml" },
                "/user": { $ref: "paths/user.yaml" },
            },
        });

        const plan = importSpec(spec, "external-only.yaml");

        expect(plan.requests).toHaveLength(0);
        expect(plan.stats).toEqual({
            totalPaths: 2,
            importedOperations: 0,
            skippedExternalPathRefs: 2,
            skippedUnsupportedPaths: 0,
        });
        expect(
            plan.warnings.some((warning) =>
                warning.includes("Skipped 2 path(s) using external refs")
            )
        ).toBe(true);
    });

    it("imports inline operations while skipping external path refs", () => {
        const spec = JSON.stringify({
            openapi: "3.1.0",
            info: { title: "Mixed API", version: "1.0.0" },
            paths: {
                "/users/{username}": { $ref: "paths/users_{username}.yaml" },
                "/health": {
                    get: {
                        operationId: "healthCheck",
                        responses: { "200": { description: "ok" } },
                    },
                },
                "/trace-only": {
                    trace: {
                        responses: { "200": { description: "ok" } },
                    },
                },
            },
        });

        const plan = importSpec(spec, "mixed-external.yaml");

        expect(plan.requests).toHaveLength(1);
        expect(plan.stats).toEqual({
            totalPaths: 3,
            importedOperations: 1,
            skippedExternalPathRefs: 1,
            skippedUnsupportedPaths: 1,
        });
        expect(requestByName(plan.requests, "healthCheck").url).toContain("/health");
    });

    it("keeps normal inline path import behavior unchanged", () => {
        const spec = JSON.stringify({
            openapi: "3.0.3",
            info: { title: "Inline API", version: "1.0.0" },
            paths: {
                "/ping": {
                    get: {
                        operationId: "ping",
                        responses: { "200": { description: "ok" } },
                    },
                },
                "/pong": {
                    post: {
                        operationId: "pong",
                        responses: { "200": { description: "ok" } },
                    },
                },
            },
        });

        const plan = importSpec(spec, "inline-only.yaml");

        expect(plan.requests).toHaveLength(2);
        expect(plan.stats).toEqual({
            totalPaths: 2,
            importedOperations: 2,
            skippedExternalPathRefs: 0,
            skippedUnsupportedPaths: 0,
        });
    });
});
