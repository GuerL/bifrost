import { describe, expect, it } from "vitest";
import type { Request } from "../types.ts";
import {
    applyDraftPatch,
    resolveRequestForExecution,
    setFullDraftInMap,
} from "./requestExecutionSnapshot.ts";

function buildRequest(overrides: Partial<Request> = {}): Request {
    return {
        id: "req_1",
        name: "Request 1",
        method: "get",
        url: "https://example.com",
        headers: [],
        query: [],
        body: { type: "none" },
        auth: { type: "none" },
        extractors: [],
        scripts: { pre_request: "", post_response: "" },
        ...overrides,
    };
}

describe("resolveRequestForExecution", () => {
    it("returns the draft when available", () => {
        const saved = buildRequest({ scripts: { pre_request: "", post_response: "saved" } });
        const draft = buildRequest({ scripts: { pre_request: "", post_response: "draft" } });

        const resolved = resolveRequestForExecution(
            "req_1",
            { req_1: draft },
            { requests: [saved] }
        );

        expect(resolved?.scripts.post_response).toBe("draft");
    });

    it("falls back to collection request when no draft exists", () => {
        const saved = buildRequest({ scripts: { pre_request: "", post_response: "saved" } });

        const resolved = resolveRequestForExecution("req_1", {}, { requests: [saved] });

        expect(resolved?.scripts.post_response).toBe("saved");
    });
});

describe("applyDraftPatch", () => {
    it("uses latest draft map state as base instead of stale fallback request", () => {
        const staleFallback = buildRequest({
            scripts: { pre_request: "", post_response: "stale" },
            headers: [{ key: "X-Stale", value: "1" }],
        });
        const latestDraft = buildRequest({
            scripts: { pre_request: "", post_response: "latest" },
            headers: [{ key: "X-Latest", value: "1" }],
        });

        const { nextDraft, nextDraftsById } = applyDraftPatch({
            requestId: "req_1",
            draftsById: { req_1: latestDraft },
            fallbackRequest: staleFallback,
            patch: {
                scripts: {
                    pre_request: "",
                    post_response: "latest + edit",
                },
            },
        });

        expect(nextDraft.scripts.post_response).toBe("latest + edit");
        expect(nextDraft.headers).toEqual([{ key: "X-Latest", value: "1" }]);
        expect(nextDraftsById.req_1.headers).toEqual([{ key: "X-Latest", value: "1" }]);
    });
});

describe("setFullDraftInMap", () => {
    it("stores full draft immediately in map", () => {
        const nextDraft = buildRequest({ name: "Updated" });

        const map = setFullDraftInMap("req_1", {}, nextDraft);

        expect(map.req_1.name).toBe("Updated");
    });
});
