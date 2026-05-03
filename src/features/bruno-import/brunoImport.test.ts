import { describe, expect, it } from "vitest";
import { parseBrunoYamlCollection } from "./brunoYamlParser.ts";
import { mapBrunoToBifrost } from "./brunoToBifrost.ts";

const VALID_BRUNO_SINGLE_FILE_YAML = `
opencollection: 1.0.0
info:
  name: Bruno Export Sample
request:
  headers:
    - name: X-Root
      value: "{{rootHeader}}"
items:
  - info:
      name: Users
      type: folder
    request:
      auth:
        type: basic
        username: "{{basicUser}}"
        password: "{{basicPass}}"
    items:
      - info:
          name: Get User
          type: http
        http:
          method: GET
          url: "{{baseUrl}}/users/:id"
          headers:
            - name: X-Trace-Id
              value: "{{traceId}}"
          params:
            - name: id
              value: "{{userId}}"
              type: path
            - name: expand
              value: roles
              type: query
      - info:
          name: Create User
          type: http
        http:
          method: POST
          url: "{{baseUrl}}/users"
          headers:
            - name: Content-Type
              value: application/json
          params:
            - name: debug
              value: "true"
              type: query
          body:
            type: json
            data: '{"name":"{{name}}","email":"{{email}}"}'
          auth:
            type: bearer
            token: "{{token}}"
      - info:
          name: Update Note
          type: http
        http:
          method: PATCH
          url: "{{baseUrl}}/notes/{noteId}"
          params:
            - name: noteId
              value: "{{noteId}}"
              type: path
          body:
            type: text
            data: "hello {{noteBody}}"
          auth: inherit
      - info:
          name: Profiles
          type: folder
        items:
          - info:
              name: Get Profile
              type: http
            http:
              method: GET
              url: "{{baseUrl}}/profiles/{{profileId}}"
  - info:
      name: Admin
      type: folder
    items:
      - info:
          name: Submit Form
          type: http
        http:
          method: POST
          url: "{{baseUrl}}/forms"
          body:
            type: form-urlencoded
            data:
              - name: title
                value: "{{title}}"
              - name: ignored
                value: "1"
                disabled: true
      - info:
          name: Upload Avatar
          type: http
        http:
          method: POST
          url: "{{baseUrl}}/upload"
          body:
            type: multipart-form
            data:
              - name: file
                type: file
                value: "/tmp/avatar.png"
              - name: description
                type: text
                value: "avatar {{userId}}"
`;

function importBrunoCollection(specText: string, fileName = "collection.yml") {
    const parsed = parseBrunoYamlCollection(specText);
    return mapBrunoToBifrost(parsed, fileName);
}

function requestByName(
    requests: ReturnType<typeof importBrunoCollection>["requests"],
    name: string
) {
    const match = requests.find((entry) => entry.request.name === name);
    expect(match).toBeTruthy();
    if (!match) {
        throw new Error(`Request not found: ${name}`);
    }
    return match;
}

describe("Bruno single-file YAML import", () => {
    it("imports a valid Bruno single-file YAML collection", () => {
        const plan = importBrunoCollection(VALID_BRUNO_SINGLE_FILE_YAML);
        expect(plan.requests.length).toBeGreaterThan(0);
        expect(plan.collectionName).toBe("Bruno Export Sample");
        expect(plan.preview.sourceVersion).toBe("1.0.0");
    });

    it("maps collection name from metadata with fallback to file name", () => {
        const named = importBrunoCollection(VALID_BRUNO_SINGLE_FILE_YAML, "named.yml");
        expect(named.collectionName).toBe("Bruno Export Sample");

        const unnamedSpec = `
opencollection: 1.0.0
info: {}
items:
  - info:
      name: Ping
      type: http
    http:
      method: GET
      url: https://example.com/ping
`;
        const fallback = importBrunoCollection(unnamedSpec, "my-export.yaml");
        expect(fallback.collectionName).toBe("my-export");
    });

    it("maps request method and url", () => {
        const plan = importBrunoCollection(VALID_BRUNO_SINGLE_FILE_YAML);
        const getUser = requestByName(plan.requests, "Get User").request;
        expect(getUser.method).toBe("get");
        expect(getUser.url).toBe("{{baseUrl}}/users/{{userId}}");
    });

    it("maps headers", () => {
        const plan = importBrunoCollection(VALID_BRUNO_SINGLE_FILE_YAML);
        const getUser = requestByName(plan.requests, "Get User").request;
        expect(getUser.headers).toEqual(
            expect.arrayContaining([
                { key: "X-Root", value: "{{rootHeader}}" },
                { key: "X-Trace-Id", value: "{{traceId}}" },
            ])
        );
    });

    it("maps query params", () => {
        const plan = importBrunoCollection(VALID_BRUNO_SINGLE_FILE_YAML);
        const createUser = requestByName(plan.requests, "Create User").request;
        expect(createUser.query).toEqual(
            expect.arrayContaining([{ key: "debug", value: "true" }])
        );
    });

    it("maps JSON body", () => {
        const plan = importBrunoCollection(VALID_BRUNO_SINGLE_FILE_YAML);
        const createUser = requestByName(plan.requests, "Create User").request;
        expect(createUser.body.type).toBe("json");
        if (createUser.body.type !== "json") {
            throw new Error("Expected JSON body");
        }
        expect(createUser.body.value).toEqual({
            name: "{{name}}",
            email: "{{email}}",
        });
    });

    it("maps raw/text body", () => {
        const plan = importBrunoCollection(VALID_BRUNO_SINGLE_FILE_YAML);
        const updateNote = requestByName(plan.requests, "Update Note").request;
        expect(updateNote.body.type).toBe("raw");
        if (updateNote.body.type !== "raw") {
            throw new Error("Expected raw body");
        }
        expect(updateNote.body.content_type).toBe("text/plain");
        expect(updateNote.body.text).toBe("hello {{noteBody}}");
    });

    it("preserves folder hierarchy", () => {
        const plan = importBrunoCollection(VALID_BRUNO_SINGLE_FILE_YAML);
        expect(requestByName(plan.requests, "Get User").folderPath).toEqual(["Users"]);
        expect(requestByName(plan.requests, "Get Profile").folderPath).toEqual([
            "Users",
            "Profiles",
        ]);
        expect(requestByName(plan.requests, "Upload Avatar").folderPath).toEqual(["Admin"]);
    });

    it("preserves variable placeholders", () => {
        const plan = importBrunoCollection(VALID_BRUNO_SINGLE_FILE_YAML);
        const updateNote = requestByName(plan.requests, "Update Note").request;
        expect(updateNote.url).toContain("{{noteId}}");
        expect(updateNote.body.type).toBe("raw");
        if (updateNote.body.type !== "raw") {
            throw new Error("Expected raw body");
        }
        expect(updateNote.body.text).toContain("{{noteBody}}");
        expect(updateNote.auth.type).toBe("basic");
        if (updateNote.auth.type !== "basic") {
            throw new Error("Expected basic auth");
        }
        expect(updateNote.auth.username).toBe("{{basicUser}}");
        expect(updateNote.auth.password).toBe("{{basicPass}}");

        const createUser = requestByName(plan.requests, "Create User").request;
        expect(createUser.auth.type).toBe("bearer");
        if (createUser.auth.type !== "bearer") {
            throw new Error("Expected bearer auth");
        }
        expect(createUser.auth.token).toBe("{{token}}");
    });

    it("rejects invalid YAML", () => {
        expect(() => parseBrunoYamlCollection("not: [valid")).toThrow(/Invalid YAML syntax/i);
    });

    it("rejects unsupported Bruno/OpenCollection shape", () => {
        expect(() =>
            parseBrunoYamlCollection(`
info:
  name: Missing version
items: []
`)
        ).toThrow(/Unsupported Bruno\/OpenCollection shape/i);
    });
});
