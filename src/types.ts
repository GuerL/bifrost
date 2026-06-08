import type { MultipartField } from "./helpers/requestBodyTypes.ts";
export type {
    MultipartField,
    MultipartFileField,
    MultipartTextField,
} from "./helpers/requestBodyTypes.ts";

export type CollectionMeta = {
    version: number;
    id: string;
    name: string;
    request_order: string[];
    items: CollectionNode[];
};

export type CollectionFolderNode = {
    type: "folder";
    id: string;
    name: string;
    children: CollectionNode[];
};

export type CollectionRequestRefNode = {
    type: "request_ref";
    request_id: string;
};

export type CollectionNode = CollectionFolderNode | CollectionRequestRefNode;

export type KeyValue = { key: string; value: string; enabled?: boolean };

export type GeneratedHeaderName =
    | "host"
    | "user-agent"
    | "accept"
    | "accept-encoding"
    | "connection"
    | "content-length"
    | "content-type"
    | "cookie";

export type GeneratedHeaderControl = {
    key: GeneratedHeaderName;
    enabled: boolean;
};

export type Body =
    | { type: "none" }
    | { type: "raw"; content_type: string; text: string }
    | { type: "json"; value: any; text?: string }
    | { type: "form"; fields: KeyValue[] }
    | { type: "multipart"; fields: MultipartField[] };

export type RequestAuth =
    | { type: "none" }
    | { type: "bearer"; token: string }
    | { type: "basic"; username: string; password: string }
    | { type: "api_key"; key: string; value: string; in: "header" | "query" };

export type ResponseExtractorRule =
    | { id: string; from: "json_body"; variable: string; path: string }
    | { id: string; from: "header"; variable: string; header: string };

export type RequestScripts = {
    pre_request: string;
    post_response: string;
};

export type RequestTls = {
    allow_invalid_certificates?: boolean;
    ca_certificate_path?: string;
    client_certificate_path?: string;
};

export type Request = {
    id: string;
    name: string;
    method: "get" | "post" | "put" | "patch" | "delete" | "head" | "options";
    url: string;
    headers: KeyValue[];
    generated_headers?: GeneratedHeaderControl[];
    query: KeyValue[];
    body: Body;
    auth: RequestAuth;
    tls?: RequestTls;
    extractors: ResponseExtractorRule[];
    scripts: RequestScripts;
};

export type CollectionLoaded = {
    meta: CollectionMeta;
    requests: Request[];
};

export type HttpResponseDto = {
    status: number;
    headers: { key: string; value: string }[];
    body_text: string;
    duration_ms: number;
};

export type EnvironmentVariable = {
    key: string;
    value: string;
};

export type Environment = {
    id: string;
    name: string;
    variables: EnvironmentVariable[];
};

export type SettingsTabId = "general" | "themes" | "shortcuts" | "proxy" | "about";

export type CustomProxySettings = {
    http_enabled: boolean;
    https_enabled: boolean;
    host: string;
    port: string;
    requires_authentication: boolean;
    username: string;
    password: string;
    bypass_list: string;
};

export type ManualEnvironmentProxySettings = {
    http_proxy: string;
    https_proxy: string;
    all_proxy: string;
    no_proxy: string;
};

export type ProxySettings = {
    use_system_proxy: boolean;
    respect_environment_variables: boolean;
    use_custom_proxy: boolean;
    custom: CustomProxySettings;
    manual_environment: ManualEnvironmentProxySettings;
};

export type RequestBehaviorSettings = {
    request_timeout_ms: number;
};

export type SecuritySettings = {
    verify_tls_certificates: boolean;
};

export type StorageSettings = {
    enable_autosave: boolean;
    autosave_interval_ms: number;
};

export type ApplicationBehaviorSettings = {
    restore_opened_requests_on_startup: boolean;
    restore_last_workspace_on_startup: boolean;
};

export type GeneralSettings = {
    requests: RequestBehaviorSettings;
    security: SecuritySettings;
    storage: StorageSettings;
    application: ApplicationBehaviorSettings;
};

export type AppSettings = {
    general: GeneralSettings;
    proxy: ProxySettings;
};

export type ProxyResolutionMode = "custom" | "system" | "environment" | "direct";

export type ProxyResolutionInfo = {
    mode: ProxyResolutionMode;
    summary: string;
    proxy_url: string | null;
    detail: string | null;
    diagnostics: string[];
};

export type ProxyEnvironmentVariableSnapshot = {
    key: string;
    value: string | null;
};

export type MacOsSystemProxyDiagnostics = {
    supported: boolean;
    http_enabled: boolean;
    http_proxy: string | null;
    http_port: number | null;
    https_enabled: boolean;
    https_proxy: string | null;
    https_port: number | null;
    socks_enabled: boolean;
    socks_proxy: string | null;
    socks_port: number | null;
    pac_enabled: boolean;
    pac_url: string | null;
};

export type ProxyDiagnosticsResolution = {
    configured_mode: string;
    detected_source: string;
    effective_proxy: string | null;
    detail: string | null;
};

export type ProxyDiagnosticsInfo = {
    target_url: string;
    process_environment_variables: ProxyEnvironmentVariableSnapshot[];
    launchctl_environment_variables: ProxyEnvironmentVariableSnapshot[];
    login_shell_environment_variables: ProxyEnvironmentVariableSnapshot[];
    macos_system_configuration: MacOsSystemProxyDiagnostics;
    effective_environment_source: string | null;
    visibility_warning: string | null;
    resolution: ProxyDiagnosticsResolution;
};

export type ImportPostmanResult = {
    collection_id: string;
    collection_name: string;
    imported_requests: number;
    imported_folders: number;
    imported_environment_id: string | null;
    warnings: string[];
};

export type ImportPortableResult = {
    collection_id: string;
    collection_name: string;
    imported_requests: number;
    warnings: string[];
};
