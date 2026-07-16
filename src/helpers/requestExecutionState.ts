import type { HttpResponseDto } from "../types.ts";

export type TransportErrorCategory =
    | "timeout"
    | "cancelled"
    | "dns"
    | "proxy"
    | "proxy_auth"
    | "tls"
    | "connection_refused"
    | "connection_reset"
    | "connection"
    | "redirect"
    | "invalid_url"
    | "invalid_request"
    | "unknown";

export type RequestExecutionState =
    | { phase: "idle" }
    | { phase: "running"; startedAt: number }
    | { phase: "success"; response: HttpResponseDto; completedAt: number }
    | { phase: "http_error"; response: HttpResponseDto; completedAt: number }
    | {
          phase: "transport_error";
          category: TransportErrorCategory;
          title: string;
          message: string;
          detail?: string;
          durationMs?: number;
          completedAt: number;
      };

export type RequestExecutionStateMap = Record<string, RequestExecutionState>;

export type ParsedHttpError = {
    kind: string;
    message: string;
    detail?: string;
    durationMs?: number;
};

export function emptyExecutionState(): RequestExecutionState {
    return { phase: "idle" };
}

export function isRequestRunning(
    states: RequestExecutionStateMap,
    requestId: string | null | undefined
): boolean {
    if (!requestId) return false;
    return states[requestId]?.phase === "running";
}

export function startRequestExecution(
    states: RequestExecutionStateMap,
    requestId: string,
    now = Date.now()
): RequestExecutionStateMap {
    if (states[requestId]?.phase === "running") {
        return states;
    }
    return {
        ...states,
        [requestId]: { phase: "running", startedAt: now },
    };
}

export function finishRequestExecutionWithResponse(
    states: RequestExecutionStateMap,
    requestId: string,
    response: HttpResponseDto,
    now = Date.now()
): RequestExecutionStateMap {
    return {
        ...states,
        [requestId]: {
            phase: response.status >= 400 ? "http_error" : "success",
            response,
            completedAt: now,
        },
    };
}

export function finishRequestExecutionWithTransportError(
    states: RequestExecutionStateMap,
    requestId: string,
    error: ParsedHttpError,
    now = Date.now()
): RequestExecutionStateMap {
    const category = classifyTransportError(error);
    const presentation = transportErrorPresentation(category, error);
    return {
        ...states,
        [requestId]: {
            phase: "transport_error",
            category,
            title: presentation.title,
            message: presentation.message,
            detail: error.detail,
            durationMs: error.durationMs,
            completedAt: now,
        },
    };
}

export function cancelRequestExecution(
    states: RequestExecutionStateMap,
    requestId: string,
    durationMs?: number,
    now = Date.now()
): RequestExecutionStateMap {
    return {
        ...states,
        [requestId]: {
            phase: "transport_error",
            category: "cancelled",
            title: "Request cancelled",
            message: "Request cancelled",
            durationMs,
            completedAt: now,
        },
    };
}

export function classifyTransportError(error: ParsedHttpError): TransportErrorCategory {
    const kind = error.kind.trim().toLowerCase();
    const text = `${error.message} ${error.detail ?? ""}`.toLowerCase();

    if (kind === "cancelled") return "cancelled";
    if (kind === "timeout" || text.includes("timed out") || text.includes("deadline")) return "timeout";
    if (kind === "dns" || text.includes("dns") || text.includes("resolve") || text.includes("name or service")) return "dns";
    if (kind === "proxy_auth" || text.includes("proxy authentication") || text.includes("407")) return "proxy_auth";
    if (kind === "proxy" || text.includes("proxy")) return "proxy";
    if (kind === "tls" || kind === "tls_config" || text.includes("certificate") || text.includes("tls") || text.includes("ssl")) return "tls";
    if (kind === "invalid_url" || text.includes("invalid url") || text.includes("relative url")) return "invalid_url";
    if (kind === "invalid_request" || kind === "invalid_header" || kind === "variables") return "invalid_request";
    if (kind === "redirect" || text.includes("redirect")) return "redirect";
    if (text.includes("connection refused") || text.includes("os error 61") || text.includes("os error 111")) return "connection_refused";
    if (text.includes("connection reset") || text.includes("reset by peer")) return "connection_reset";
    if (kind === "connect" || kind === "connection" || text.includes("connection") || text.includes("connect")) return "connection";

    return "unknown";
}

export function transportErrorPresentation(
    category: TransportErrorCategory,
    error: ParsedHttpError
): { title: string; message: string } {
    switch (category) {
        case "timeout":
            return {
                title: "Request timed out",
                message:
                    error.durationMs != null
                        ? `The server did not respond within ${error.durationMs} ms.`
                        : "The server did not respond before the timeout.",
            };
        case "cancelled":
            return { title: "Request cancelled", message: "Request cancelled" };
        case "dns":
            return { title: "DNS resolution failed", message: "The host name could not be resolved." };
        case "proxy":
            return { title: "Proxy connection failed", message: "The request could not connect through the configured proxy." };
        case "proxy_auth":
            return { title: "Proxy authentication failed", message: "The proxy rejected the configured credentials." };
        case "tls":
            return { title: "TLS handshake failed", message: "The secure connection or certificate validation failed." };
        case "connection_refused":
            return { title: "Connection refused", message: "The remote host refused the connection." };
        case "connection_reset":
            return { title: "Connection reset", message: "The connection was reset before the response completed." };
        case "connection":
            return { title: "Connection failed", message: "The request could not establish a network connection." };
        case "redirect":
            return { title: "Redirect failed", message: "The request could not complete the redirect chain." };
        case "invalid_url":
            return { title: "Invalid URL", message: "The request URL is invalid." };
        case "invalid_request":
            return { title: "Invalid request", message: error.message || "The request could not be sent." };
        case "unknown":
        default:
            return { title: "Unknown transport error", message: error.message || "The request failed before an HTTP response was received." };
    }
}

export function statusTextForExecutionState(
    state: RequestExecutionState | undefined,
    elapsedMs: number,
    fallback: string
): string {
    if (!state || state.phase === "idle") return fallback;
    if (state.phase === "running") return `Running • ${formatElapsedSeconds(elapsedMs)}`;
    if (state.phase === "success") return `Success • ${state.response.status} ${httpStatusReason(state.response.status)} • ${state.response.duration_ms} ms`;
    if (state.phase === "http_error") return `HTTP Error • ${state.response.status} ${httpStatusReason(state.response.status)} • ${state.response.duration_ms} ms`;
    if (state.category === "timeout") {
        return state.durationMs != null
            ? `Request timed out • ${state.durationMs} ms`
            : "Request timed out";
    }
    return state.title;
}

export function formatElapsedSeconds(elapsedMs: number): string {
    return `${Math.max(0, elapsedMs / 1000).toFixed(1)} s`;
}

function httpStatusReason(status: number): string {
    const reasons: Record<number, string> = {
        200: "OK",
        201: "Created",
        202: "Accepted",
        204: "No Content",
        301: "Moved Permanently",
        302: "Found",
        304: "Not Modified",
        400: "Bad Request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not Found",
        409: "Conflict",
        422: "Unprocessable Content",
        429: "Too Many Requests",
        500: "Internal Server Error",
        502: "Bad Gateway",
        503: "Service Unavailable",
        504: "Gateway Timeout",
    };
    return reasons[status] ?? "";
}
