import { describe, expect, it } from "vitest";
import type { Request } from "../types.ts";
import {
    buildGeneratedHeadersPreview,
    CALCULATED_HEADER_VALUE,
    defaultGeneratedHeaderControls,
    disabledRequestHeaders,
    enabledRequestHeaders,
    generatedHeaderControlMap,
    OVERRIDDEN_HEADER_VALUE,
} from "./requestHeadersPreview.ts";

function buildRequest(overrides: Partial<Request> = {}): Request {
    return {
        id: "req_1",
        name: "Request 1",
        method: "post",
        url: "https://api.example.com/v1/ping",
        headers: [],
        generated_headers: defaultGeneratedHeaderControls(),
        query: [],
        body: { type: "none" },
        auth: { type: "none" },
        extractors: [],
        scripts: { pre_request: "", post_response: "" },
        ...overrides,
    };
}

function rowValue(
    rows: ReturnType<typeof buildGeneratedHeadersPreview>,
    key: string
): string {
    const found = rows.find((row) => row.key === key);
    if (!found) {
        throw new Error(`Expected row '${key}'`);
    }
    return found.value;
}

describe("buildGeneratedHeadersPreview", () => {
    it("derives host and reqwest defaults", () => {
        const rows = buildGeneratedHeadersPreview({
            request: buildRequest(),
        });

        expect(rowValue(rows, "host")).toBe("api.example.com");
        expect(rowValue(rows, "accept")).toBe("*/*");
        expect(rowValue(rows, "user-agent")).toBe(CALCULATED_HEADER_VALUE);
    });

    it("shows default user-agent from the application version", () => {
        const rows = buildGeneratedHeadersPreview({
            request: buildRequest(),
            appVersion: "1.13.0",
        });

        expect(rowValue(rows, "user-agent")).toBe("BifrostRuntime/1.13.0");
    });

    it("shows generated user-agent as overridden by an enabled custom header", () => {
        const rows = buildGeneratedHeadersPreview({
            request: buildRequest({
                headers: [{ key: "user-agent", value: "MyCustomClient", enabled: true }],
            }),
            appVersion: "1.13.0",
        });

        expect(rowValue(rows, "user-agent")).toBe(OVERRIDDEN_HEADER_VALUE);
    });

    it("calculates content length and content type", () => {
        const rawRows = buildGeneratedHeadersPreview({
            request: buildRequest({
                body: {
                    type: "raw",
                    content_type: "text/plain",
                    text: "hello",
                },
            }),
        });
        expect(rowValue(rawRows, "content-length")).toBe("5");
        expect(rowValue(rawRows, "content-type")).toBe("text/plain");

        const formRows = buildGeneratedHeadersPreview({
            request: buildRequest({
                body: {
                    type: "form",
                    fields: [{ key: "a", value: "b c", enabled: true }],
                },
            }),
        });
        expect(rowValue(formRows, "content-length")).toBe("5");
        expect(rowValue(formRows, "content-type")).toBe(
            "application/x-www-form-urlencoded"
        );
    });

    it("keeps multipart content-length and content-type as calculated", () => {
        const rows = buildGeneratedHeadersPreview({
            request: buildRequest({
                body: {
                    type: "multipart",
                    fields: [],
                },
            }),
        });

        expect(rowValue(rows, "content-length")).toBe(CALCULATED_HEADER_VALUE);
        expect(rowValue(rows, "content-type")).toBe(CALCULATED_HEADER_VALUE);
    });
});

describe("generatedHeaderControlMap", () => {
    it("defaults to enabled when request has no generated header controls", () => {
        const map = generatedHeaderControlMap(
            buildRequest({ generated_headers: undefined })
        );
        expect(map.get("host")).toBe(true);
        expect(map.get("content-type")).toBe(true);
    });

    it("applies disabled generated headers", () => {
        const map = generatedHeaderControlMap(
            buildRequest({
                generated_headers: [
                    { key: "host", enabled: false },
                    { key: "content-length", enabled: false },
                ],
            })
        );
        expect(map.get("host")).toBe(false);
        expect(map.get("content-length")).toBe(false);
        expect(map.get("accept")).toBe(true);
    });
});

describe("request header enabled filters", () => {
    it("splits enabled and disabled custom headers", () => {
        const headers = [
            { key: "X-A", value: "1", enabled: true },
            { key: "X-B", value: "2", enabled: false },
            { key: "X-C", value: "3" },
        ];

        expect(enabledRequestHeaders(headers)).toEqual([
            { key: "X-A", value: "1", enabled: true },
            { key: "X-C", value: "3" },
        ]);
        expect(disabledRequestHeaders(headers)).toEqual([
            { key: "X-B", value: "2", enabled: false },
        ]);
    });
});
