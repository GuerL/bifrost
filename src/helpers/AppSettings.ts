import { invoke } from "@tauri-apps/api/core";
import type {
    ApplicationBehaviorSettings,
    AppSettings,
    CustomProxySettings,
    GeneralSettings,
    ProxyResolutionInfo,
    ProxySettings,
    RequestBehaviorSettings,
    SecuritySettings,
    SettingsTabId,
    StorageSettings,
} from "../types.ts";

const SETTINGS_LAST_TAB_STORAGE_KEY = "bifrost:settings:last-tab:v1";
const SETTINGS_TABS: SettingsTabId[] = ["general", "themes", "shortcuts", "proxy", "about"];

export const DEFAULT_CUSTOM_PROXY_SETTINGS: CustomProxySettings = {
    http_enabled: true,
    https_enabled: true,
    host: "",
    port: "",
    requires_authentication: false,
    username: "",
    password: "",
    bypass_list: "",
};

export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
    use_system_proxy: false,
    respect_environment_variables: false,
    use_custom_proxy: false,
    custom: DEFAULT_CUSTOM_PROXY_SETTINGS,
};

export const DEFAULT_REQUEST_BEHAVIOR_SETTINGS: RequestBehaviorSettings = {
    request_timeout_ms: 60_000,
};

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
    verify_tls_certificates: true,
};

export const DEFAULT_STORAGE_SETTINGS: StorageSettings = {
    enable_autosave: true,
    autosave_interval_ms: 300,
};

export const DEFAULT_APPLICATION_BEHAVIOR_SETTINGS: ApplicationBehaviorSettings = {
    restore_opened_requests_on_startup: true,
    restore_last_workspace_on_startup: true,
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
    requests: DEFAULT_REQUEST_BEHAVIOR_SETTINGS,
    security: DEFAULT_SECURITY_SETTINGS,
    storage: DEFAULT_STORAGE_SETTINGS,
    application: DEFAULT_APPLICATION_BEHAVIOR_SETTINGS,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
    general: DEFAULT_GENERAL_SETTINGS,
    proxy: DEFAULT_PROXY_SETTINGS,
};

function isSettingsTabId(value: unknown): value is SettingsTabId {
    return typeof value === "string" && SETTINGS_TABS.includes(value as SettingsTabId);
}

function sanitizeString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function sanitizeBoolean(value: unknown, defaultValue = false): boolean {
    return typeof value === "boolean" ? value : defaultValue;
}

function sanitizeNonNegativeInteger(value: unknown, defaultValue: number): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(0, Math.floor(value));
    }

    if (typeof value === "string") {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return Math.max(0, parsed);
        }
    }

    return defaultValue;
}

export function sanitizeCustomProxySettings(value: unknown): CustomProxySettings {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_CUSTOM_PROXY_SETTINGS };
    }

    const source = value as Record<string, unknown>;

    return {
        http_enabled: sanitizeBoolean(source.http_enabled, true),
        https_enabled: sanitizeBoolean(source.https_enabled, true),
        host: sanitizeString(source.host),
        port: sanitizeString(source.port),
        requires_authentication: sanitizeBoolean(source.requires_authentication, false),
        username: sanitizeString(source.username),
        password: sanitizeString(source.password),
        bypass_list: sanitizeString(source.bypass_list),
    };
}

export function sanitizeRequestBehaviorSettings(value: unknown): RequestBehaviorSettings {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_REQUEST_BEHAVIOR_SETTINGS };
    }

    const source = value as Record<string, unknown>;

    return {
        request_timeout_ms: sanitizeNonNegativeInteger(
            source.request_timeout_ms,
            DEFAULT_REQUEST_BEHAVIOR_SETTINGS.request_timeout_ms
        ),
    };
}

export function sanitizeSecuritySettings(value: unknown): SecuritySettings {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_SECURITY_SETTINGS };
    }

    const source = value as Record<string, unknown>;

    return {
        verify_tls_certificates: sanitizeBoolean(
            source.verify_tls_certificates,
            DEFAULT_SECURITY_SETTINGS.verify_tls_certificates
        ),
    };
}

export function sanitizeStorageSettings(value: unknown): StorageSettings {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_STORAGE_SETTINGS };
    }

    const source = value as Record<string, unknown>;

    return {
        enable_autosave: sanitizeBoolean(
            source.enable_autosave,
            DEFAULT_STORAGE_SETTINGS.enable_autosave
        ),
        autosave_interval_ms: sanitizeNonNegativeInteger(
            source.autosave_interval_ms,
            DEFAULT_STORAGE_SETTINGS.autosave_interval_ms
        ),
    };
}

export function sanitizeApplicationBehaviorSettings(
    value: unknown
): ApplicationBehaviorSettings {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_APPLICATION_BEHAVIOR_SETTINGS };
    }

    const source = value as Record<string, unknown>;

    return {
        restore_opened_requests_on_startup: sanitizeBoolean(
            source.restore_opened_requests_on_startup,
            DEFAULT_APPLICATION_BEHAVIOR_SETTINGS.restore_opened_requests_on_startup
        ),
        restore_last_workspace_on_startup: sanitizeBoolean(
            source.restore_last_workspace_on_startup,
            DEFAULT_APPLICATION_BEHAVIOR_SETTINGS.restore_last_workspace_on_startup
        ),
    };
}

export function sanitizeGeneralSettings(value: unknown): GeneralSettings {
    if (!value || typeof value !== "object") {
        return {
            requests: { ...DEFAULT_REQUEST_BEHAVIOR_SETTINGS },
            security: { ...DEFAULT_SECURITY_SETTINGS },
            storage: { ...DEFAULT_STORAGE_SETTINGS },
            application: { ...DEFAULT_APPLICATION_BEHAVIOR_SETTINGS },
        };
    }

    const source = value as Record<string, unknown>;

    return {
        requests: sanitizeRequestBehaviorSettings(source.requests),
        security: sanitizeSecuritySettings(source.security),
        storage: sanitizeStorageSettings(source.storage),
        application: sanitizeApplicationBehaviorSettings(source.application),
    };
}

export function sanitizeProxySettings(value: unknown): ProxySettings {
    if (!value || typeof value !== "object") {
        return {
            ...DEFAULT_PROXY_SETTINGS,
            custom: { ...DEFAULT_CUSTOM_PROXY_SETTINGS },
        };
    }

    const source = value as Record<string, unknown>;

    return {
        use_system_proxy: sanitizeBoolean(source.use_system_proxy, false),
        respect_environment_variables: sanitizeBoolean(
            source.respect_environment_variables,
            false
        ),
        use_custom_proxy: sanitizeBoolean(source.use_custom_proxy, false),
        custom: sanitizeCustomProxySettings(source.custom),
    };
}

export function sanitizeAppSettings(value: unknown): AppSettings {
    if (!value || typeof value !== "object") {
        return {
            general: {
                requests: { ...DEFAULT_REQUEST_BEHAVIOR_SETTINGS },
                security: { ...DEFAULT_SECURITY_SETTINGS },
                storage: { ...DEFAULT_STORAGE_SETTINGS },
                application: { ...DEFAULT_APPLICATION_BEHAVIOR_SETTINGS },
            },
            proxy: {
                ...DEFAULT_PROXY_SETTINGS,
                custom: { ...DEFAULT_CUSTOM_PROXY_SETTINGS },
            },
        };
    }

    const source = value as Record<string, unknown>;

    return {
        general: sanitizeGeneralSettings(source.general),
        proxy: sanitizeProxySettings(source.proxy),
    };
}

export function sanitizeProxyResolutionInfo(value: unknown): ProxyResolutionInfo {
    if (!value || typeof value !== "object") {
        return {
            mode: "direct",
            summary: "Direct connection",
            proxy_url: null,
            detail: null,
            diagnostics: [],
        };
    }

    const source = value as Record<string, unknown>;
    const mode = source.mode;

    return {
        mode:
            mode === "custom" ||
            mode === "system" ||
            mode === "environment" ||
            mode === "direct"
                ? mode
                : "direct",
        summary: sanitizeString(source.summary) || "Direct connection",
        proxy_url: typeof source.proxy_url === "string" ? source.proxy_url : null,
        detail: typeof source.detail === "string" ? source.detail : null,
        diagnostics: Array.isArray(source.diagnostics)
            ? source.diagnostics.filter((value): value is string => typeof value === "string")
            : [],
    };
}

export async function loadAppSettings(): Promise<AppSettings> {
    const result = await invoke("load_app_settings");
    return sanitizeAppSettings(result);
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
    await invoke("save_app_settings", { settings: sanitizeAppSettings(settings) });
}

export async function resolveProxyTransport(
    url: string,
    proxySettingsOverride?: ProxySettings
): Promise<ProxyResolutionInfo> {
    const result = await invoke("resolve_proxy_transport", {
        url,
        proxySettingsOverride: proxySettingsOverride
            ? sanitizeProxySettings(proxySettingsOverride)
            : undefined,
    });
    return sanitizeProxyResolutionInfo(result);
}

export function readStoredSettingsTab(): SettingsTabId {
    if (typeof window === "undefined") return "general";

    try {
        const raw = window.localStorage.getItem(SETTINGS_LAST_TAB_STORAGE_KEY);
        return isSettingsTabId(raw) ? raw : "general";
    } catch {
        return "general";
    }
}

export function writeStoredSettingsTab(tab: SettingsTabId) {
    if (typeof window === "undefined") return;

    try {
        window.localStorage.setItem(SETTINGS_LAST_TAB_STORAGE_KEY, tab);
    } catch {
        // ignore storage write failures
    }
}
