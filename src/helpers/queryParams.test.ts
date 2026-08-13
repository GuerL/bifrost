import { describe, expect, it } from "vitest";
import type { KeyValue, Request } from "../types.ts";
import {
    buildUrlWithQueryParams,
    effectiveRequestUrl,
    parseQueryString,
    reconcileUrlQueryWithParams,
    serializeQueryParams,
} from "./queryParams.ts";

function request(overrides: Partial<Request> = {}): Request {
    return {
        id: "req_1",
        name: "Request",
        method: "get",
        url: "https://example.com/api",
        headers: [],
        query: [],
        body: { type: "none" },
        auth: { type: "none" },
        extractors: [],
        scripts: { pre_request: "", post_response: "" },
        ...overrides,
    };
}

describe("query param URL synchronization", () => {
    it("adds params to the URL", () => {
        expect(buildUrlWithQueryParams("https://example.com/api", [
            { key: "foo", value: "1", enabled: true },
        ])).toBe("https://example.com/api?foo=1");
    });

    it("edits params in the URL", () => {
        expect(buildUrlWithQueryParams("https://example.com/api?foo=1", [
            { key: "foo", value: "42", enabled: true },
        ])).toBe("https://example.com/api?foo=42");
    });

    it("removes params from the URL", () => {
        expect(buildUrlWithQueryParams("https://example.com/api?foo=1&bar=2", [
            { key: "foo", value: "1", enabled: true },
        ])).toBe("https://example.com/api?foo=1");
    });

    it("preserves reordered params in the URL", () => {
        expect(buildUrlWithQueryParams("https://example.com/api", [
            { key: "productMerge", value: "True", enabled: true },
            { key: "propositions", value: "INSTANT", enabled: true },
            { key: "propositions", value: "FASTTRACK", enabled: true },
        ])).toBe("https://example.com/api?productMerge=True&propositions=INSTANT&propositions=FASTTRACK");
    });

    it("omits disabled params and restores them when re-enabled at the same position", () => {
        const disabled: KeyValue[] = [
            { key: "foo", value: "1", enabled: true },
            { key: "debug", value: "true", enabled: false },
            { key: "bar", value: "2", enabled: true },
        ];
        expect(buildUrlWithQueryParams("https://example.com/api", disabled)).toBe(
            "https://example.com/api?foo=1&bar=2"
        );

        const reenabled = disabled.map((entry) =>
            entry.key === "debug" ? { ...entry, enabled: true } : entry
        );
        expect(buildUrlWithQueryParams("https://example.com/api", reenabled)).toBe(
            "https://example.com/api?foo=1&debug=true&bar=2"
        );
    });

    it("preserves duplicate names", () => {
        expect(serializeQueryParams([
            { key: "propositions", value: "INSTANT", enabled: true },
            { key: "propositions", value: "FASTTRACK", enabled: true },
        ])).toBe("propositions=INSTANT&propositions=FASTTRACK");
    });

    it("creates params from URL edits", () => {
        expect(reconcileUrlQueryWithParams([], "https://example.com/api?foo=1&bar=2")).toEqual([
            { key: "foo", value: "1", enabled: true },
            { key: "bar", value: "2", enabled: true },
        ]);
    });

    it("updates existing params from URL edits", () => {
        expect(reconcileUrlQueryWithParams([
            { key: "foo", value: "1", enabled: true },
            { key: "bar", value: "2", enabled: true },
        ], "https://example.com/api?foo=42&hello=world")).toEqual([
            { key: "foo", value: "42", enabled: true },
            { key: "hello", value: "world", enabled: true },
        ]);
    });

    it("removes enabled params removed directly from the URL", () => {
        expect(reconcileUrlQueryWithParams([
            { key: "foo", value: "1", enabled: true },
            { key: "bar", value: "2", enabled: true },
        ], "https://example.com/api?foo=1")).toEqual([
            { key: "foo", value: "1", enabled: true },
        ]);
    });

    it("keeps disabled params while reconciling URL edits", () => {
        expect(reconcileUrlQueryWithParams([
            { key: "foo", value: "1", enabled: true },
            { key: "debug", value: "true", enabled: false },
            { key: "bar", value: "2", enabled: true },
        ], "https://example.com/api?foo=10&bar=2")).toEqual([
            { key: "foo", value: "10", enabled: true },
            { key: "debug", value: "true", enabled: false },
            { key: "bar", value: "2", enabled: true },
        ]);
    });

    it("encodes and decodes special characters without double encoding", () => {
        const query = [
            { key: "space", value: "hello world", enabled: true },
            { key: "plus", value: "a+b", enabled: true },
            { key: "symbols", value: "a&b=c%25", enabled: true },
        ];
        const serialized = serializeQueryParams(query);

        expect(serialized).toBe("space=hello+world&plus=a%2Bb&symbols=a%26b%3Dc%2525");
        expect(parseQueryString(serialized)).toEqual(query);
    });

    it("supports empty and unicode values", () => {
        const query = [
            { key: "empty", value: "", enabled: true },
            { key: "hello", value: "世界", enabled: true },
        ];

        expect(parseQueryString(serializeQueryParams(query))).toEqual(query);
    });

    it("does not persist empty placeholder rows", () => {
        const persisted = JSON.parse(JSON.stringify([
            { key: "foo", value: "1", enabled: true },
        ]));

        expect(persisted).toEqual([{ key: "foo", value: "1", enabled: true }]);
    });

    it("defaults legacy saved params to enabled behavior", () => {
        expect(buildUrlWithQueryParams("https://example.com/api", [
            { key: "legacy", value: "1" },
        ])).toBe("https://example.com/api?legacy=1");
    });

    it("builds the final effective request URL from the displayed model", () => {
        expect(effectiveRequestUrl(request({
            url: "https://example.com/api?stale=1",
            query: [
                { key: "foo", value: "1", enabled: true },
                { key: "bar", value: "2", enabled: false },
            ],
        }))).toBe("https://example.com/api?foo=1");
    });

    it("includes query API key auth in final effective request URL", () => {
        expect(effectiveRequestUrl(request({
            query: [{ key: "foo", value: "1", enabled: true }],
            auth: { type: "api_key", key: "token", value: "abc", in: "query" },
        }))).toBe("https://example.com/api?foo=1&token=abc");
    });
});
