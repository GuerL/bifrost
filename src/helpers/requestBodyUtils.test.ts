import { describe, expect, it } from "vitest";
import type { MultipartField, Request } from "../types.ts";
import { enabledMultipartFields, prepareRequestForExecution } from "./requestBodyUtils.ts";

type MultipartRequest = Omit<Request, "body"> & {
    body: { type: "multipart"; fields: MultipartField[] };
};

function buildMultipartRequest(fields: MultipartField[]): MultipartRequest {
    return {
        id: "req_1",
        name: "Multipart request",
        method: "post",
        url: "https://example.com/upload",
        headers: [],
        query: [],
        body: {
            type: "multipart",
            fields,
        },
        auth: { type: "none" },
        extractors: [],
        scripts: { pre_request: "", post_response: "" },
    };
}

describe("requestBodyUtils multipart", () => {
    it("filters disabled multipart rows", () => {
        const request = buildMultipartRequest([
            { id: "1", enabled: true, kind: "text", name: "a", value: "1" },
            { id: "2", enabled: false, kind: "text", name: "b", value: "2" },
        ]);

        const enabled = enabledMultipartFields(request.body.fields);
        expect(enabled).toEqual([{ id: "1", enabled: true, kind: "text", name: "a", value: "1" }]);
    });

    it("validates missing file path", () => {
        const request = buildMultipartRequest([
            { id: "1", enabled: true, kind: "file", name: "file", file_path: "" },
        ]);

        const prepared = prepareRequestForExecution(request);
        expect(prepared.ok).toBe(false);
        if (prepared.ok) return;
        expect(prepared.message).toContain("no file selected");
    });

    it("maps text fields correctly for execution", () => {
        const request = buildMultipartRequest([
            { id: "1", enabled: true, kind: "text", name: "  description  ", value: "hello" },
        ]);

        const prepared = prepareRequestForExecution(request);
        expect(prepared.ok).toBe(true);
        if (!prepared.ok) return;
        expect(prepared.request.body).toEqual({
            type: "multipart",
            fields: [{ id: "1", enabled: true, kind: "text", name: "description", value: "hello" }],
        });
    });

    it("maps file fields correctly for execution", () => {
        const request = buildMultipartRequest([
            {
                id: "1",
                enabled: true,
                kind: "file",
                name: "file",
                file_path: " /tmp/report.pdf ",
            },
        ]);

        const prepared = prepareRequestForExecution(request);
        expect(prepared.ok).toBe(true);
        if (!prepared.ok) return;
        expect(prepared.request.body).toEqual({
            type: "multipart",
            fields: [
                {
                    id: "1",
                    enabled: true,
                    kind: "file",
                    name: "file",
                    file_path: "/tmp/report.pdf",
                    file_name: "report.pdf",
                },
            ],
        });
    });
});
