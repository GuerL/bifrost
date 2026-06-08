import type {
    GeneralSettings,
    GeneratedHeaderName,
    KeyValue,
    ProxyResolutionInfo,
    Request,
} from "../types.ts";
import {
    CALCULATED_HEADER_VALUE,
    GENERATED_HEADER_ORDER,
    buildGeneratedHeadersPreview,
    disabledRequestHeaders,
    enabledRequestHeaders,
    generatedHeaderControlMap,
    generatedHeaderLabel,
} from "./requestHeadersPreview.ts";

const VARIABLE_PATTERN = /{{\s*([^{}]+?)\s*}}/g;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const BODY_PREVIEW_LIMIT = 6_000;

type DebugHeaderRow = {
    key: string;
    value: string;
    source: "custom" | "generated";
};

export type RequestDebugInfo = {
    method: string;
    resolvedUrl: string;
    unresolvedVariables: string[];
    enabledHeaders: DebugHeaderRow[];
    disabledHeaders: string[];
    bodyType: Request["body"]["type"];
    bodyPreview: string;
    contentTypeMode: string;
    contentLengthMode: string;
    transport: {
        proxySummary: string;
        proxyTarget: string;
        proxyDetail: string | null;
        proxyDiagnostics: string[];
        tlsValidation: string;
        customCaCertificate: string;
        clientCertificate: string;
        redirects: string;
        timeoutMs: number;
    };
};

function truncateText(input: string): string {
    if (input.length <= BODY_PREVIEW_LIMIT) return input;
    return `${input.slice(0, BODY_PREVIEW_LIMIT)}\n...<truncated>`;
}

function resolveKnownVariables(input: string, variableValues: Map<string, string>): {
    value: string;
    unresolvedVariables: string[];
} {
    const unresolved = new Set<string>();
    const value = input.replace(VARIABLE_PATTERN, (rawMatch, rawName: string) => {
        const key = rawName.trim();
        if (!key) return rawMatch;
        const resolved = variableValues.get(key);
        if (resolved === undefined) {
            unresolved.add(key);
            return rawMatch;
        }
        return resolved;
    });

    return {
        value,
        unresolvedVariables: Array.from(unresolved.values()).sort((a, b) =>
            a.localeCompare(b)
        ),
    };
}

function toHeaderDisplayName(rawKey: string): string {
    const key = rawKey.trim();
    if (!key) return rawKey;
    return key
        .split("-")
        .map((part) =>
            part.length > 0
                ? `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`
                : part
        )
        .join("-");
}

function isSameHeaderName(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function hasEnabledHeader(headers: KeyValue[], headerName: string): boolean {
    return headers.some((header) => {
        if (header.enabled === false) return false;
        if (!header.key.trim()) return false;
        return isSameHeaderName(header.key, headerName);
    });
}

function bodyPreview(request: Request): string {
    const { body } = request;

    if (body.type === "none") return "<none>";

    if (body.type === "raw") {
        const text = body.text;
        if (!text) return "<empty>";
        return truncateText(text);
    }

    if (body.type === "json") {
        if (body.text && body.text.trim().length > 0) {
            return truncateText(body.text);
        }

        try {
            return truncateText(JSON.stringify(body.value, null, 2));
        } catch {
            return "<unserializable JSON>";
        }
    }

    if (body.type === "form") {
        const pairs = body.fields
            .filter((field) => field.enabled !== false && field.key.trim().length > 0)
            .map((field) => `${field.key}=${field.value}`);
        if (pairs.length === 0) return "<empty>";
        return truncateText(pairs.join("\n"));
    }

    const multipartRows = body.fields
        .filter((field) => field.enabled !== false)
        .map((field) => {
            if (field.kind === "text") {
                return `${field.name}: ${field.value}`;
            }
            const path = field.file_path.trim() || "<not selected>";
            return `${field.name}: @${path}`;
        });

    if (multipartRows.length === 0) return "<empty>";
    return truncateText(multipartRows.join("\n"));
}

function buildEnabledHeaders(
    request: Request,
    generatedRows: ReturnType<typeof buildGeneratedHeadersPreview>
): DebugHeaderRow[] {
    const rows: DebugHeaderRow[] = [];
    const existing = new Set<string>();
    const generatedEnabledByKey = generatedHeaderControlMap(request);

    for (const header of enabledRequestHeaders(request.headers)) {
        const key = header.key.trim();
        if (!key) continue;
        rows.push({
            key,
            value: header.value,
            source: "custom",
        });
        existing.add(key.toLowerCase());
    }

    for (const row of generatedRows) {
        if (!row.enabled) continue;
        if (!generatedEnabledByKey.get(row.key)) continue;
        if (existing.has(row.key)) continue;
        rows.push({
            key: row.label,
            value: row.value,
            source: "generated",
        });
    }

    return rows;
}

function buildDisabledHeaders(
    request: Request,
    generatedRows: ReturnType<typeof buildGeneratedHeadersPreview>
): string[] {
    const values: string[] = [];
    const seen = new Set<string>();

    for (const header of disabledRequestHeaders(request.headers)) {
        const key = header.key.trim();
        if (!key) continue;
        const normalized = key.toLowerCase();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        values.push(toHeaderDisplayName(key));
    }

    for (const row of generatedRows) {
        if (row.enabled) continue;
        const normalized = row.key.toLowerCase();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        values.push(row.label);
    }

    return values;
}

function describeContentTypeMode(
    request: Request,
    generatedEnabled: Map<GeneratedHeaderName, boolean>
): string {
    if (hasEnabledHeader(request.headers, "content-type")) {
        return "custom header";
    }
    if (generatedEnabled.get("content-type") === false) {
        return "disabled";
    }

    if (request.body.type === "none") {
        return "not set";
    }
    if (request.body.type === "multipart") {
        return "auto-generated by HTTP client (multipart boundary)";
    }
    return "auto-generated by Bifrost";
}

function describeContentLengthMode(
    request: Request,
    generatedEnabled: Map<GeneratedHeaderName, boolean>
): string {
    if (hasEnabledHeader(request.headers, "content-length")) {
        return "custom header";
    }
    if (generatedEnabled.get("content-length") === false) {
        return "disabled";
    }
    if (request.body.type === "none") {
        return "calculated by HTTP client when needed";
    }
    if (request.body.type === "multipart") {
        return "calculated by HTTP client (multipart body)";
    }
    return "calculated from body";
}

export function buildRequestDebugInfo(args: {
    request: Request;
    variableValues?: Map<string, string>;
    proxyTransport?: ProxyResolutionInfo | null;
    generalSettings?: GeneralSettings;
}): RequestDebugInfo {
    const variableValues = args.variableValues ?? new Map<string, string>();
    const resolvedUrl = resolveKnownVariables(args.request.url, variableValues);
    const generatedRows = buildGeneratedHeadersPreview({
        request: args.request,
        variableValues,
    });
    const generatedEnabled = generatedHeaderControlMap(args.request);
    const requestTls = args.request.tls ?? {};
    const proxyTransport = args.proxyTransport ?? {
        mode: "direct" as const,
        summary: "Direct connection",
        proxy_url: null,
        detail: null,
        diagnostics: [],
    };
    const generalSettings = args.generalSettings;
    const verifyTlsCertificates =
        generalSettings?.security.verify_tls_certificates ?? true;
    const requestTimeoutMs =
        generalSettings?.requests.request_timeout_ms ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return {
        method: args.request.method.toUpperCase(),
        resolvedUrl: resolvedUrl.value,
        unresolvedVariables: resolvedUrl.unresolvedVariables,
        enabledHeaders: buildEnabledHeaders(args.request, generatedRows),
        disabledHeaders: buildDisabledHeaders(args.request, generatedRows),
        bodyType: args.request.body.type,
        bodyPreview: bodyPreview(args.request),
        contentTypeMode: describeContentTypeMode(args.request, generatedEnabled),
        contentLengthMode: describeContentLengthMode(args.request, generatedEnabled),
        transport: {
            proxySummary: proxyTransport.summary,
            proxyTarget: proxyTransport.proxy_url ?? "<none>",
            proxyDetail: proxyTransport.detail,
            proxyDiagnostics: proxyTransport.diagnostics ?? [],
            tlsValidation: !verifyTlsCertificates
                ? "disabled (general setting)"
                : requestTls.allow_invalid_certificates
                  ? "disabled (allow invalid certificates)"
                  : "enabled",
            customCaCertificate: requestTls.ca_certificate_path?.trim() || "<none>",
            clientCertificate: requestTls.client_certificate_path?.trim() || "<none>",
            redirects: "follow (HTTP client default)",
            timeoutMs: requestTimeoutMs,
        },
    };
}

export function buildRequestDebugText(info: RequestDebugInfo): string {
    const lines: string[] = [];
    lines.push("Bifrost request debug");
    lines.push(`Method: ${info.method}`);
    lines.push(`URL: ${info.resolvedUrl}`);
    if (info.unresolvedVariables.length > 0) {
        lines.push(`Unresolved variables: ${info.unresolvedVariables.join(", ")}`);
    }
    lines.push("");
    lines.push("Enabled headers:");
    if (info.enabledHeaders.length === 0) {
        lines.push("(none)");
    } else {
        for (const header of info.enabledHeaders) {
            lines.push(`${header.key}: ${header.value}`);
        }
    }

    lines.push("");
    lines.push("Disabled headers:");
    if (info.disabledHeaders.length === 0) {
        lines.push("(none)");
    } else {
        for (const headerName of info.disabledHeaders) {
            lines.push(headerName);
        }
    }

    lines.push("");
    lines.push(`Body type: ${info.bodyType}`);
    lines.push(`Content-Type mode: ${info.contentTypeMode}`);
    lines.push(`Content-Length mode: ${info.contentLengthMode}`);
    lines.push("Body:");
    lines.push(info.bodyPreview || "<none>");
    lines.push("");
    lines.push("Transport:");
    lines.push(`Proxy: ${info.transport.proxySummary}`);
    lines.push(`Proxy target: ${info.transport.proxyTarget}`);
    if (info.transport.proxyDetail) {
        lines.push(`Proxy detail: ${info.transport.proxyDetail}`);
    }
    for (const diagnostic of info.transport.proxyDiagnostics) {
        lines.push(diagnostic);
    }
    lines.push(`TLS validation: ${info.transport.tlsValidation}`);
    lines.push(`Custom CA certificate: ${info.transport.customCaCertificate}`);
    lines.push(`Client certificate: ${info.transport.clientCertificate}`);
    lines.push(`Redirects: ${info.transport.redirects}`);
    lines.push(`Timeout: ${info.transport.timeoutMs}ms`);

    return lines.join("\n");
}

export function generatedHeaderEnabled(
    request: Request,
    key: GeneratedHeaderName
): boolean {
    const enabledByKey = generatedHeaderControlMap(request);
    return enabledByKey.get(key) !== false;
}

export function generatedHeaderDisplayRows(args: {
    request: Request;
    variableValues?: Map<string, string>;
}): Array<{ key: GeneratedHeaderName; label: string; value: string; enabled: boolean; note: string }> {
    const rows = buildGeneratedHeadersPreview(args);
    return GENERATED_HEADER_ORDER.map((key) => {
        const row = rows.find((entry) => entry.key === key);
        if (row) return row;
        return {
            key,
            label: generatedHeaderLabel(key),
            value: CALCULATED_HEADER_VALUE,
            enabled: true,
            note: "",
        };
    });
}
