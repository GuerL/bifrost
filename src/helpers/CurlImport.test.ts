import { describe, expect, it } from "vitest";
import { buildCurlCommand } from "./CurlCommand.ts";
import { parseCurlCommand } from "./CurlImport.ts";

describe("parseCurlCommand", () => {
    it("parses a simple GET request", () => {
        const parsed = parseCurlCommand("curl https://example.com");

        expect(parsed.method).toBe("GET");
        expect(parsed.url).toBe("https://example.com");
        expect(parsed.headers).toEqual([]);
        expect(parsed.body).toBeUndefined();
    });

    it("parses POST with JSON body", () => {
        const parsed = parseCurlCommand(
            "curl -X POST https://api.example.com/items -H 'Content-Type: application/json' -d '{\"name\":\"bifrost\"}'"
        );

        expect(parsed.method).toBe("POST");
        expect(parsed.url).toBe("https://api.example.com/items");
        expect(parsed.headers).toEqual([
            { name: "Content-Type", value: "application/json", enabled: true },
        ]);
        expect(parsed.body).toEqual({
            type: "raw",
            content: "{\"name\":\"bifrost\"}",
        });
    });

    it("preserves repeated headers", () => {
        const parsed = parseCurlCommand(
            "curl https://example.com -H 'X-Test: one' -H 'X-Test: two'"
        );

        expect(parsed.headers).toEqual([
            { name: "X-Test", value: "one", enabled: true },
            { name: "X-Test", value: "two", enabled: true },
        ]);
    });

    it("handles multiline commands", () => {
        const parsed = parseCurlCommand(
            "curl https://example.com \\\n  -H 'Accept: application/json' \\\n  --data-raw 'a=1&b=2'"
        );

        expect(parsed.method).toBe("POST");
        expect(parsed.url).toBe("https://example.com");
        expect(parsed.headers).toEqual([
            { name: "Accept", value: "application/json", enabled: true },
        ]);
        expect(parsed.body).toEqual({
            type: "raw",
            content: "a=1&b=2",
        });
    });

    it("keeps quoted values and template variables", () => {
        const parsed = parseCurlCommand(
            "curl \"https://api.example.com/{{resource}}\" -H 'X-Env: {{env}}' --data-raw '{\"query\":\"{{query}}\"}'"
        );

        expect(parsed.url).toBe("https://api.example.com/{{resource}}");
        expect(parsed.headers).toEqual([
            { name: "X-Env", value: "{{env}}", enabled: true },
        ]);
        expect(parsed.body).toEqual({
            type: "raw",
            content: "{\"query\":\"{{query}}\"}",
        });
    });

    it("keeps query params from URL", () => {
        const parsed = parseCurlCommand("curl 'https://example.com/search?q=abc&x=1'");
        expect(parsed.url).toBe("https://example.com/search?q=abc&x=1");
    });

    it("uses implicit POST when data is present", () => {
        const parsed = parseCurlCommand("curl https://example.com -d 'a=1'");
        expect(parsed.method).toBe("POST");
        expect(parsed.body).toEqual({ type: "raw", content: "a=1" });
    });

    it("supports explicit methods", () => {
        const withHead = parseCurlCommand("curl -I https://example.com");
        const withPut = parseCurlCommand("curl --request PUT https://example.com/resource");

        expect(withHead.method).toBe("HEAD");
        expect(withPut.method).toBe("PUT");
    });

    it("rejects invalid input", () => {
        expect(() => parseCurlCommand("")).toThrow();
        expect(() => parseCurlCommand("curl")).toThrow();
        expect(() => parseCurlCommand("curl 'https://example.com")).toThrow();
    });

    it("roundtrips with Copy as cURL export", () => {
        const curl = buildCurlCommand({
            method: "post",
            url: "https://api.example.com/items",
            headers: [
                { key: "Content-Type", value: "application/json" },
                { key: "X-Trace", value: "{{traceId}}" },
            ],
            body: {
                type: "raw",
                text: "{\"name\":\"bifrost\"}",
                content_type: "application/json",
            },
        });

        const parsed = parseCurlCommand(curl);

        expect(parsed.method).toBe("POST");
        expect(parsed.url).toBe("https://api.example.com/items");
        expect(parsed.headers).toEqual([
            { name: "Content-Type", value: "application/json", enabled: true },
            { name: "X-Trace", value: "{{traceId}}", enabled: true },
        ]);
        expect(parsed.body).toEqual({
            type: "raw",
            content: "{\"name\":\"bifrost\"}",
        });
    });
});
