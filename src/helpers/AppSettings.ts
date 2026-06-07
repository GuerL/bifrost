import { invoke } from "@tauri-apps/api/core";
import type {
    AppSettings,
    CustomProxySettings,
    ProxyResolutionInfo,
    ProxySettings,
    SettingsTabId,
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

export const DEFAULT_APP_SETTINGS: AppSettings = {
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
            proxy: {
                ...DEFAULT_PROXY_SETTINGS,
                custom: { ...DEFAULT_CUSTOM_PROXY_SETTINGS },
            },
        };
    }

    const source = value as Record<string, unknown>;

    return {
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
