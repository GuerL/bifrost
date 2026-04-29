import { describe, expect, it } from "vitest";
import { parseBifrostClipboardPayload } from "./ClipboardRequestTransfer.ts";

describe("parseBifrostClipboardPayload", () => {
    it("accepts multipart file metadata serialized as null", () => {
        const payload = {
            bifrostType: "request",
            version: 1,
            request: {
                id: "req_1",
                name: "Upload",
                method: "post",
                url: "https://example.com/upload",
                headers: [],
                query: [],
                body: {
                    type: "multipart",
                    fields: [
                        {
                            kind: "file",
                            id: "f_1",
                            enabled: true,
                            name: "file",
                            file_path: "/tmp/test.png",
                            file_name: "test.png",
                            mime_type: null,
                            size: null,
                        },
                    ],
                },
                auth: { type: "none" },
                extractors: [],
                scripts: { pre_request: "", post_response: "" },
            },
        };

        const parsed = parseBifrostClipboardPayload(JSON.stringify(payload));
        expect(parsed).not.toBeNull();
        expect(parsed?.request.body.type).toBe("multipart");
        if (!parsed || parsed.request.body.type !== "multipart") return;
        const field = parsed.request.body.fields[0];
        expect(field.kind).toBe("file");
        if (field.kind !== "file") return;
        expect(field.mime_type).toBeUndefined();
        expect(field.size).toBeUndefined();
    });
});
