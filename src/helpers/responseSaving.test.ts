import { describe, expect, it } from "vitest";
import { invalidateStoredResponseBytes, responseSaveErrorMessage } from "./responseSaving.ts";
import type { HttpResponseDto } from "../types.ts";

describe("persisted response byte lifecycle", () => {
    it.each(["text", "binary"] as const)("invalidates process-local IDs for %s previews without mutating live responses", kind => {
        const live: HttpResponseDto = { status: 200, duration_ms: 1, headers: [], body_text: '{ "a": 1 }',
            body: { kind, body_id: "old-process-id", available: true, downloadable: true, filename: "response.json", size: 10, description: "response" } };
        const restored = invalidateStoredResponseBytes(live)!;
        expect(restored.body).toMatchObject({ body_id: "", available: false, downloadable: false });
        expect(restored.body_text).toBe(kind === "text" ? live.body_text : "");
        expect(live.body?.available).toBe(true);
        expect(invalidateStoredResponseBytes(restored)).toEqual(restored);
    });
    it("accepts absent responses", () => expect(invalidateStoredResponseBytes(null)).toBeNull());
    it("does not expose arbitrary backend error details", () => {
        expect(responseSaveErrorMessage("secret response content")).toBe("Unable to save response.");
        expect(responseSaveErrorMessage("response_data_unavailable")).toBe("No response data available to save.");
        expect(responseSaveErrorMessage("save_permission_denied")).toContain("permissions");
    });
});
