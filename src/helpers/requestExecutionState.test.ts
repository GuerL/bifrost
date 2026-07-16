import { describe, expect, it } from "vitest";
import {
    cancelRequestExecution,
    classifyTransportError,
    emptyExecutionState,
    finishRequestExecutionWithResponse,
    finishRequestExecutionWithTransportError,
    isRequestRunning,
    startRequestExecution,
    statusTextForExecutionState,
    type RequestExecutionStateMap,
} from "./requestExecutionState.ts";
import type { HttpResponseDto } from "../types.ts";

function response(status: number, duration_ms = 128): HttpResponseDto {
    return {
        status,
        duration_ms,
        headers: [],
        body_text: status >= 400 ? "error" : "ok",
    };
}

describe("request execution state", () => {
    it("shows running state after Send", () => {
        const states = startRequestExecution({}, "req-a", 1_000);

        expect(states["req-a"]).toEqual({ phase: "running", startedAt: 1_000 });
        expect(statusTextForExecutionState(states["req-a"], 4_200, "Idle")).toBe("Running • 4.2 s");
    });

    it("locks only the executing request", () => {
        const states = startRequestExecution({}, "req-a", 1_000);

        expect(isRequestRunning(states, "req-a")).toBe(true);
        expect(isRequestRunning(states, "req-b")).toBe(false);
    });

    it("keeps running scoped when switching tabs", () => {
        const states = startRequestExecution({}, "req-a", 1_000);
        const activeTabRequestId = "req-b";

        expect(states["req-a"]?.phase).toBe("running");
        expect(states[activeTabRequestId]).toBeUndefined();
    });

    it("prevents duplicate execution state replacement for the same request", () => {
        const first = startRequestExecution({}, "req-a", 1_000);
        const duplicate = startRequestExecution(first, "req-a", 2_000);

        expect(duplicate).toBe(first);
        expect(duplicate["req-a"]).toEqual({ phase: "running", startedAt: 1_000 });
    });

    it("cancel abort result unlocks the request", () => {
        const running = startRequestExecution({}, "req-a", 1_000);
        const cancelled = cancelRequestExecution(running, "req-a", 320, 1_320);

        expect(isRequestRunning(cancelled, "req-a")).toBe(false);
        expect(cancelled["req-a"]).toMatchObject({
            phase: "transport_error",
            category: "cancelled",
            title: "Request cancelled",
        });
    });

    it("timeout produces Timeout state and unlocks editing", () => {
        const running = startRequestExecution({}, "req-a", 1_000);
        const timedOut = finishRequestExecutionWithTransportError(
            running,
            "req-a",
            { kind: "timeout", message: "Request timed out", durationMs: 5_000 },
            6_000
        );

        expect(isRequestRunning(timedOut, "req-a")).toBe(false);
        expect(timedOut["req-a"]).toMatchObject({
            phase: "transport_error",
            category: "request_timeout",
            title: "Request timed out",
            message: "The server did not respond within 5000 ms.",
        });
        expect(statusTextForExecutionState(timedOut["req-a"], 0, "Idle")).toBe("⏱ Request timed out");
    });

    it("classifies transport errors into friendly categories", () => {
        expect(classifyTransportError({ kind: "dns", message: "lookup failed" })).toBe("dns");
        expect(classifyTransportError({ kind: "proxy", message: "proxy connect failed" })).toBe("proxy");
        expect(classifyTransportError({ kind: "unknown", message: "407 proxy authentication required" })).toBe("proxy_auth");
        expect(classifyTransportError({ kind: "tls", message: "certificate verify failed" })).toBe("tls");
        expect(classifyTransportError({ kind: "connect", message: "connection refused" })).toBe("connection_refused");
        expect(classifyTransportError({ kind: "connection_timeout", message: "deadline elapsed" })).toBe("connection_timeout");
        expect(classifyTransportError({ kind: "request_timeout", message: "deadline elapsed" })).toBe("request_timeout");
        expect(classifyTransportError({ kind: "protocol", message: "connection reset by peer" })).toBe("connection_reset");
        expect(classifyTransportError({ kind: "redirect", message: "too many redirects" })).toBe("redirect");
        expect(classifyTransportError({ kind: "invalid_url", message: "relative URL" })).toBe("invalid_url");
        expect(classifyTransportError({ kind: "unknown", message: "opaque failure" })).toBe("unknown");
    });

    it("HTTP errors remain HTTP responses", () => {
        const states = finishRequestExecutionWithResponse({}, "req-a", response(500, 84), 2_000);

        expect(states["req-a"]).toMatchObject({ phase: "http_error", response: { status: 500 } });
        expect(statusTextForExecutionState(states["req-a"], 0, "Idle")).toBe(
            "❌ HTTP 500"
        );
    });

    it("uses explicit status badges for network categories", () => {
        const refused = finishRequestExecutionWithTransportError(
            {},
            "req-a",
            { kind: "connection_refused", message: "connection refused" },
            1_000
        );
        const connectTimeout = finishRequestExecutionWithTransportError(
            {},
            "req-b",
            { kind: "connection_timeout", message: "operation timed out" },
            1_000
        );

        expect(statusTextForExecutionState(refused["req-a"], 0, "Idle")).toBe("❌ Connection refused");
        expect(statusTextForExecutionState(connectTimeout["req-b"], 0, "Idle")).toBe("❌ Connection timed out");
    });

    it("running indicator belongs only to the correct tab", () => {
        const states = startRequestExecution(startRequestExecution({}, "req-a", 1_000), "req-c", 1_500);
        const tabIds = ["req-a", "req-b", "req-c"];

        expect(tabIds.filter((id) => states[id]?.phase === "running")).toEqual(["req-a", "req-c"]);
        expect(states["req-b"]).toBeUndefined();
    });

    it("previous response is not confused with current execution", () => {
        const withPrevious = finishRequestExecutionWithResponse({}, "req-a", response(200, 100), 1_000);
        const runningAgain = startRequestExecution(withPrevious, "req-a", 2_000);

        expect(runningAgain["req-a"]).toEqual({ phase: "running", startedAt: 2_000 });
        expect(statusTextForExecutionState(runningAgain["req-a"], 480, "Success • 200 OK • 100 ms")).toBe(
            "Running • 0.5 s"
        );
    });

    it("execution state resets correctly when no runtime map is restored", () => {
        const runtimeOnlyStates: RequestExecutionStateMap = {};

        expect(runtimeOnlyStates["req-a"]).toBeUndefined();
        expect(statusTextForExecutionState(emptyExecutionState(), 0, "No request sent yet.")).toBe(
            "No request sent yet."
        );
    });
});
