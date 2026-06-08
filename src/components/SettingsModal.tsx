import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import bifrostLogo from "../assets/bifrost_logo.svg";
import {
    readStoredSettingsTab,
    writeStoredSettingsTab,
} from "../helpers/AppSettings.ts";
import { listShortcuts } from "../helpers/ShortcutRegistry.ts";
import {
    THEME_OPTIONS,
    formatThemeLabel,
    type ResolvedTheme,
    type Theme,
} from "../helpers/Theme.tsx";
import {
    buttonStyle,
    modalInputStyle,
} from "../helpers/UiStyles.ts";
import type {
    AppSettings,
    ProxyResolutionInfo,
    ProxySettings,
    SettingsTabId,
} from "../types.ts";

type SettingsModalProps = {
    open: boolean;
    theme: Theme;
    systemTheme: ResolvedTheme;
    appSettings: AppSettings;
    saveState: "idle" | "saving" | "saved" | "error";
    saveError: string;
    proxyPreview: ProxyResolutionInfo | null;
    proxyPreviewError: string;
    onThemeChange: (nextTheme: Theme) => void;
    onProxySettingsChange: (nextProxySettings: ProxySettings) => void;
    onClose: () => void;
};

type ProxySource = "direct" | "system" | "custom";

type AboutRuntimeInfo = {
    version: string;
    architecture: string;
    platform: string;
    runtime: string;
};

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
    { id: "general", label: "General" },
    { id: "themes", label: "Themes" },
    { id: "shortcuts", label: "Shortcuts" },
    { id: "proxy", label: "Proxy" },
    { id: "about", label: "About" },
];

const shellStyle = {
    width: "min(860px, calc(100vw - 40px))",
    height: "min(680px, calc(100vh - 48px))",
    minHeight: 460,
    border: "1px solid var(--pg-border)",
    borderRadius: 16,
    background: "var(--pg-surface-1)",
    boxShadow: "0 24px 60px rgba(0, 0, 0, 0.28)",
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
};

const sectionCardStyle = {
    border: "1px solid var(--pg-border)",
    borderRadius: 12,
    background: "var(--pg-surface-0)",
    padding: 14,
    display: "grid",
    gap: 12,
};

const fieldLabelStyle = {
    display: "grid",
    gap: 6,
    minWidth: 0,
};

const fieldCaptionStyle = {
    fontSize: 12,
    color: "var(--pg-text-muted)",
    fontWeight: 700,
};

const proxyTabStackStyle = {
    display: "grid",
    gap: 10,
    alignContent: "start" as const,
};

const proxySectionStyle = {
    ...sectionCardStyle,
    padding: 12,
    gap: 10,
    display: "flex",
    flexDirection: "column" as const,
    alignSelf: "start" as const,
};

const proxySettingRowStyle = {
    display: "flex",
    alignItems: "flex-start" as const,
    gap: 10,
    cursor: "pointer",
    padding: "2px 0",
};

const proxyFieldGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 10,
};

function sanitizeAboutRuntimeInfo(value: unknown): AboutRuntimeInfo {
    if (!value || typeof value !== "object") {
        return {
            version: "Unavailable",
            architecture: "Unavailable",
            platform: "Unavailable",
            runtime: "Tauri",
        };
    }

    const source = value as Record<string, unknown>;

    return {
        version: typeof source.version === "string" && source.version ? source.version : "Unavailable",
        architecture:
            typeof source.architecture === "string" && source.architecture
                ? source.architecture
                : "Unavailable",
        platform: typeof source.platform === "string" && source.platform ? source.platform : "Unavailable",
        runtime: typeof source.runtime === "string" && source.runtime ? source.runtime : "Tauri",
    };
}

function selectedProxySourceFromSettings(proxySettings: ProxySettings): ProxySource {
    if (proxySettings.use_custom_proxy) return "custom";
    if (proxySettings.use_system_proxy || proxySettings.respect_environment_variables) {
        return "system";
    }
    return "direct";
}

export default function SettingsModal({
    open,
    theme,
    systemTheme,
    appSettings,
    saveState,
    saveError,
    proxyPreview,
    proxyPreviewError,
    onThemeChange,
    onProxySettingsChange,
    onClose,
}: SettingsModalProps) {
    const [selectedTab, setSelectedTab] = useState<SettingsTabId>(() =>
        readStoredSettingsTab()
    );
    const [aboutInfo, setAboutInfo] = useState<AboutRuntimeInfo | null>(null);
    const [aboutInfoError, setAboutInfoError] = useState("");
    const shortcuts = useMemo(() => listShortcuts(), []);
    const proxySettings = appSettings.proxy;
    const activeThemeLabel = formatThemeLabel(theme, systemTheme);
    const selectedProxySource = selectedProxySourceFromSettings(proxySettings);
    const customProxyHost = proxySettings.custom.host.trim();
    const customProxyPort = proxySettings.custom.port.trim();
    const customProxyHostError =
        selectedProxySource === "custom" && customProxyHost.length === 0
            ? "Host is required."
            : "";
    const customProxyPortError =
        selectedProxySource === "custom" && customProxyPort.length === 0
            ? "Port is required."
            : "";

    useEffect(() => {
        writeStoredSettingsTab(selectedTab);
    }, [selectedTab]);

    useEffect(() => {
        if (!open) return;

        function onKeyDown(event: KeyboardEvent) {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onClose();
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    useEffect(() => {
        if (!open || selectedTab !== "about") return;

        let cancelled = false;

        invoke("get_about_runtime_info")
            .then((result) => {
                if (cancelled) return;
                setAboutInfo(sanitizeAboutRuntimeInfo(result));
                setAboutInfoError("");
            })
            .catch((error) => {
                if (cancelled) return;
                setAboutInfo({
                    version: "Unavailable",
                    architecture: "Unavailable",
                    platform: "Unavailable",
                    runtime: "Tauri",
                });
                setAboutInfoError(
                    error instanceof Error ? error.message : "Unable to load application information."
                );
            });

        return () => {
            cancelled = true;
        };
    }, [open, selectedTab]);

    if (!open) return null;

    function updateProxySettings(patch: Partial<ProxySettings>) {
        onProxySettingsChange({
            ...proxySettings,
            ...patch,
        });
    }

    function updateCustomProxySettings(
        patch: Partial<ProxySettings["custom"]>
    ) {
        onProxySettingsChange({
            ...proxySettings,
            custom: {
                ...proxySettings.custom,
                ...patch,
            },
        });
    }

    function updateProxySource(source: ProxySource) {
        if (source === "direct") {
            onProxySettingsChange({
                ...proxySettings,
                use_system_proxy: false,
                respect_environment_variables: false,
                use_custom_proxy: false,
            });
            return;
        }

        if (source === "system") {
            onProxySettingsChange({
                ...proxySettings,
                use_system_proxy: true,
                use_custom_proxy: false,
            });
            return;
        }

        onProxySettingsChange({
            ...proxySettings,
            use_system_proxy: false,
            respect_environment_variables: false,
            use_custom_proxy: true,
        });
    }

    function renderSaveState() {
        if (saveState === "saving") {
            return <span style={{ color: "var(--pg-text-muted)" }}>Saving settings...</span>;
        }
        if (saveState === "saved") {
            return <span style={{ color: "var(--pg-primary)" }}>Settings saved</span>;
        }
        if (saveState === "error") {
            return (
                <span style={{ color: "var(--pg-danger)" }}>
                    Save failed{saveError ? `: ${saveError}` : ""}
                </span>
            );
        }
        return <span style={{ color: "var(--pg-text-muted)" }}>Global settings</span>;
    }

    function renderProxyPreview() {
        if (proxyPreviewError) {
            return (
                <div
                    style={{
                        ...proxySectionStyle,
                        borderColor: "rgba(220, 38, 38, 0.45)",
                    }}
                >
                    <div style={{ ...fieldCaptionStyle, color: "var(--pg-danger)" }}>
                        Proxy resolution unavailable
                    </div>
                    <div style={{ fontSize: 13, color: "var(--pg-text-dim)" }}>
                        {proxyPreviewError}
                    </div>
                </div>
            );
        }

        const transportTitle =
            selectedProxySource === "custom"
                ? "Custom proxy"
                : selectedProxySource === "system"
                  ? "System proxy"
                  : "Direct connection";
        const transportDetail =
            selectedProxySource === "custom"
                ? customProxyHost && customProxyPort
                    ? `${customProxyHost}:${customProxyPort}`
                    : "Host and port are required."
                : selectedProxySource === "system"
                  ? proxySettings.respect_environment_variables
                        ? "Environment variables enabled."
                        : "Uses operating system proxy configuration."
                  : "No proxy used for requests.";
        const transportHelper =
            selectedProxySource === "custom"
                ? proxyPreview?.detail ?? null
                : selectedProxySource === "system" && proxySettings.respect_environment_variables
                  ? "HTTP_PROXY, HTTPS_PROXY, and NO_PROXY are considered within the system source."
                  : null;

        return (
            <div style={proxySectionStyle}>
                <div style={fieldCaptionStyle}>Active transport</div>
                <div style={{ display: "grid", gap: 3 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--pg-text)" }}>
                        {transportTitle}
                    </div>
                    <div
                        style={{
                            fontSize: 12,
                            color: "var(--pg-text-dim)",
                            fontFamily:
                                selectedProxySource === "custom" && customProxyHost && customProxyPort
                                    ? '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace'
                                    : undefined,
                        }}
                    >
                        {transportDetail}
                    </div>
                    {transportHelper && (
                        <div style={{ fontSize: 12, color: "var(--pg-text-muted)", lineHeight: 1.45 }}>
                            {transportHelper}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 1500,
                background: "rgba(8, 12, 17, 0.56)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 20,
            }}
            onMouseDown={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Settings"
                onMouseDown={(event) => event.stopPropagation()}
                style={shellStyle}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "16px 18px 14px",
                        borderBottom: "1px solid var(--pg-border)",
                    }}
                >
                    <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                        <div
                            style={{
                                fontSize: 13,
                                letterSpacing: 1.2,
                                fontWeight: 800,
                                color: "var(--pg-text)",
                            }}
                        >
                            SETTINGS
                        </div>
                        <div style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                            {renderSaveState()}
                        </div>
                    </div>
                    <button onClick={onClose} style={buttonStyle(false)} aria-label="Close settings">
                        Close
                    </button>
                </div>

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "10px 14px",
                        borderBottom: "1px solid var(--pg-border)",
                        overflowX: "auto",
                        flexShrink: 0,
                    }}
                >
                    {SETTINGS_TABS.map((tab) => {
                        const active = tab.id === selectedTab;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setSelectedTab(tab.id)}
                                style={{
                                    ...buttonStyle(false),
                                    height: 34,
                                    padding: "0 14px",
                                    borderColor: active
                                        ? "var(--pg-primary-strong)"
                                        : "var(--pg-border)",
                                    background: active
                                        ? "rgba(var(--pg-primary-rgb), 0.14)"
                                        : "transparent",
                                    color: active
                                        ? "var(--pg-text)"
                                        : "var(--pg-text-dim)",
                                    fontWeight: active ? 700 : 600,
                                    flexShrink: 0,
                                }}
                            >
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                <div
                    style={{
                        flex: 1,
                        minHeight: 0,
                        overflowY: "auto",
                        padding: 16,
                        display: "grid",
                        gap: 14,
                    }}
                >
                    {selectedTab === "general" && (
                        <>
                            <div style={sectionCardStyle}>
                                <div style={fieldCaptionStyle}>Application scope</div>
                                <div style={{ fontSize: 13, color: "var(--pg-text-dim)", lineHeight: 1.6 }}>
                                    Settings in this modal are application-wide. Proxy preferences stay
                                    active across restarts, collections, and workspace switches.
                                </div>
                            </div>
                            <div style={sectionCardStyle}>
                                <div style={fieldCaptionStyle}>Current appearance</div>
                                <div style={{ fontSize: 14, color: "var(--pg-text)" }}>
                                    Active theme: <strong>{activeThemeLabel}</strong>
                                </div>
                                <div style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                    Theme selection moved here from the top bar so future settings can
                                    live in a single place.
                                </div>
                            </div>
                        </>
                    )}

                    {selectedTab === "themes" && (
                        <div
                            style={{
                                ...sectionCardStyle,
                                display: "flex",
                                flexDirection: "column",
                                gap: 10,
                                alignSelf: "start",
                            }}
                        >
                            <div style={fieldCaptionStyle}>Theme</div>
                            <div style={{ fontSize: 12, color: "var(--pg-text-muted)", lineHeight: 1.5 }}>
                                Choose how Bifrost should appear.
                            </div>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                                    gap: 12,
                                    width: "100%",
                                    maxWidth: 720,
                                    alignSelf: "start",
                                }}
                            >
                                {THEME_OPTIONS.map((option) => {
                                    const active = option.value === theme;
                                    const description =
                                        option.value === "system"
                                            ? `${option.description} Current system theme: ${systemTheme}.`
                                            : option.description;

                                    return (
                                        <button
                                            key={option.value}
                                            onClick={() => onThemeChange(option.value)}
                                            style={{
                                                border: `1px solid ${
                                                    active
                                                        ? "var(--pg-primary-strong)"
                                                        : "var(--pg-border)"
                                                }`,
                                                borderRadius: 12,
                                                background: active
                                                    ? "rgba(var(--pg-primary-rgb), 0.13)"
                                                    : "var(--pg-surface-1)",
                                                color: "var(--pg-text)",
                                                padding: "12px 13px",
                                                textAlign: "left",
                                                cursor: "pointer",
                                                display: "grid",
                                                gap: 5,
                                                minHeight: 92,
                                                alignContent: "start",
                                                boxShadow: active
                                                    ? "0 8px 18px rgba(var(--pg-primary-rgb), 0.14)"
                                                    : "none",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    gap: 8,
                                                    alignItems: "center",
                                                }}
                                            >
                                                <span style={{ fontSize: 13, fontWeight: 700 }}>
                                                    {option.label}
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: 11,
                                                        color: active
                                                            ? "var(--pg-primary)"
                                                            : "var(--pg-text-muted)",
                                                        fontWeight: active ? 700 : 600,
                                                    }}
                                                >
                                                    {active ? "Active" : ""}
                                                </span>
                                            </div>
                                            <span
                                                style={{
                                                    fontSize: 11.5,
                                                    color: "var(--pg-text-muted)",
                                                    lineHeight: 1.45,
                                                }}
                                            >
                                                {description}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {selectedTab === "shortcuts" && (
                        <div style={sectionCardStyle}>
                            <div style={fieldCaptionStyle}>Keyboard shortcuts</div>
                            <div style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                Read-only for now. Shortcut values come from the shared registry used by
                                the application.
                            </div>
                            <div style={{ display: "grid", gap: 8 }}>
                                {shortcuts.map((shortcut) => (
                                    <div
                                        key={shortcut.id}
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "minmax(0, 1fr) auto",
                                            gap: 16,
                                            alignItems: "center",
                                            padding: "10px 12px",
                                            border: "1px solid var(--pg-border-soft)",
                                            borderRadius: 10,
                                            background: "var(--pg-surface-1)",
                                        }}
                                    >
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--pg-text)" }}>
                                                {shortcut.title}
                                            </div>
                                        </div>
                                        <div
                                            style={{
                                                fontFamily: '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace',
                                                fontSize: 12,
                                                color: "var(--pg-text-dim)",
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {shortcut.label}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {selectedTab === "proxy" && (
                        <div style={proxyTabStackStyle}>
                            {renderProxyPreview()}
                            <div style={proxySectionStyle}>
                                <div style={{ display: "grid", gap: 6 }}>
                                    <div style={fieldCaptionStyle}>Proxy source</div>
                                    <label style={proxySettingRowStyle}>
                                        <input
                                            type="radio"
                                            name="bifrost-proxy-source"
                                            checked={selectedProxySource === "direct"}
                                            onChange={() => updateProxySource("direct")}
                                        />
                                        <span style={{ display: "grid", gap: 3 }}>
                                            <span style={{ fontSize: 13, fontWeight: 700 }}>Direct connection</span>
                                            <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                                No proxy is used for requests.
                                            </span>
                                        </span>
                                    </label>
                                    <div
                                        style={{
                                            paddingTop: 8,
                                            borderTop: "1px solid var(--pg-border-soft)",
                                            display: "grid",
                                            gap: 8,
                                        }}
                                    >
                                        <label style={proxySettingRowStyle}>
                                            <input
                                                type="radio"
                                                name="bifrost-proxy-source"
                                                checked={selectedProxySource === "system"}
                                                onChange={() => updateProxySource("system")}
                                            />
                                            <span style={{ display: "grid", gap: 3 }}>
                                                <span style={{ fontSize: 13, fontWeight: 700 }}>System proxy</span>
                                                <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                                    Uses operating system proxy configuration and optional
                                                    environment-variable fallback.
                                                </span>
                                            </span>
                                        </label>

                                        {selectedProxySource === "system" && (
                                            <div
                                                style={{
                                                    marginLeft: 26,
                                                    padding: "8px 10px",
                                                    borderRadius: 10,
                                                    border: "1px solid var(--pg-border-soft)",
                                                    background: "var(--pg-surface-1)",
                                                    display: "grid",
                                                    gap: 6,
                                                }}
                                            >
                                                <label style={{ ...proxySettingRowStyle, padding: 0 }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={proxySettings.respect_environment_variables}
                                                        onChange={(event) =>
                                                            updateProxySettings({
                                                                respect_environment_variables:
                                                                    event.target.checked,
                                                                use_system_proxy: true,
                                                                use_custom_proxy: false,
                                                            })
                                                        }
                                                    />
                                                    <span style={{ display: "grid", gap: 3 }}>
                                                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                                                            Respect HTTP_PROXY / HTTPS_PROXY / NO_PROXY
                                                        </span>
                                                        <span
                                                            style={{
                                                                fontSize: 12,
                                                                color: "var(--pg-text-muted)",
                                                            }}
                                                        >
                                                            Reads <code>HTTP_PROXY</code>,{" "}
                                                            <code>HTTPS_PROXY</code>, and <code>NO_PROXY</code>.
                                                        </span>
                                                    </span>
                                                </label>
                                            </div>
                                        )}
                                    </div>
                                    <label
                                        style={{
                                            ...proxySettingRowStyle,
                                            paddingTop: 8,
                                            borderTop: "1px solid var(--pg-border-soft)",
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="bifrost-proxy-source"
                                            checked={selectedProxySource === "custom"}
                                            onChange={() => updateProxySource("custom")}
                                        />
                                        <span style={{ display: "grid", gap: 3 }}>
                                            <span style={{ fontSize: 13, fontWeight: 700 }}>Custom proxy</span>
                                            <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                                Manually configure proxy protocols, endpoint, credentials, and
                                                bypass rules.
                                            </span>
                                        </span>
                                    </label>
                                </div>

                                {selectedProxySource === "custom" && (
                                    <div
                                        style={{
                                            display: "grid",
                                            gap: 10,
                                            paddingTop: 10,
                                            borderTop: "1px solid var(--pg-border-soft)",
                                        }}
                                    >
                                        <div style={{ display: "grid", gap: 6 }}>
                                            <div style={fieldCaptionStyle}>Proxy type</div>
                                            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                                                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={proxySettings.custom.http_enabled}
                                                        onChange={(event) =>
                                                            updateCustomProxySettings({
                                                                http_enabled: event.target.checked,
                                                            })
                                                        }
                                                    />
                                                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>HTTP</span>
                                                </label>
                                                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={proxySettings.custom.https_enabled}
                                                        onChange={(event) =>
                                                            updateCustomProxySettings({
                                                                https_enabled: event.target.checked,
                                                            })
                                                        }
                                                    />
                                                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>HTTPS</span>
                                                </label>
                                            </div>
                                        </div>

                                        <div style={proxyFieldGridStyle}>
                                            <label style={fieldLabelStyle}>
                                                <span style={fieldCaptionStyle}>Proxy host</span>
                                                <input
                                                    value={proxySettings.custom.host}
                                                    onChange={(event) =>
                                                        updateCustomProxySettings({
                                                            host: event.target.value,
                                                        })
                                                    }
                                                    placeholder="proxy.company.com"
                                                    style={modalInputStyle()}
                                                />
                                                {customProxyHostError && (
                                                    <span style={{ fontSize: 12, color: "var(--pg-danger)" }}>
                                                        {customProxyHostError}
                                                    </span>
                                                )}
                                            </label>

                                            <label style={fieldLabelStyle}>
                                                <span style={fieldCaptionStyle}>Proxy port</span>
                                                <input
                                                    value={proxySettings.custom.port}
                                                    onChange={(event) =>
                                                        updateCustomProxySettings({
                                                            port: event.target.value,
                                                        })
                                                    }
                                                    placeholder="8080"
                                                    style={modalInputStyle()}
                                                />
                                                {customProxyPortError && (
                                                    <span style={{ fontSize: 12, color: "var(--pg-danger)" }}>
                                                        {customProxyPortError}
                                                    </span>
                                                )}
                                            </label>
                                        </div>

                                        <label style={proxySettingRowStyle}>
                                            <input
                                                type="checkbox"
                                                checked={proxySettings.custom.requires_authentication}
                                                onChange={(event) =>
                                                    updateCustomProxySettings({
                                                        requires_authentication: event.target.checked,
                                                    })
                                                }
                                            />
                                            <span style={{ display: "grid", gap: 3 }}>
                                                <span style={{ fontSize: 13, fontWeight: 700 }}>
                                                    Proxy requires authentication
                                                </span>
                                                <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                                    Credentials are stored with the global proxy settings.
                                                </span>
                                            </span>
                                        </label>

                                        {proxySettings.custom.requires_authentication && (
                                            <div style={proxyFieldGridStyle}>
                                                <label style={fieldLabelStyle}>
                                                    <span style={fieldCaptionStyle}>Username</span>
                                                    <input
                                                        value={proxySettings.custom.username}
                                                        onChange={(event) =>
                                                            updateCustomProxySettings({
                                                                username: event.target.value,
                                                            })
                                                        }
                                                        placeholder="proxy-user"
                                                        style={modalInputStyle()}
                                                    />
                                                </label>

                                                <label style={fieldLabelStyle}>
                                                    <span style={fieldCaptionStyle}>Password</span>
                                                    <input
                                                        type="password"
                                                        value={proxySettings.custom.password}
                                                        onChange={(event) =>
                                                            updateCustomProxySettings({
                                                                password: event.target.value,
                                                            })
                                                        }
                                                        placeholder="••••••••"
                                                        style={modalInputStyle()}
                                                    />
                                                </label>
                                            </div>
                                        )}

                                        <label style={fieldLabelStyle}>
                                            <span style={fieldCaptionStyle}>Proxy bypass</span>
                                            <input
                                                value={proxySettings.custom.bypass_list}
                                                onChange={(event) =>
                                                    updateCustomProxySettings({
                                                        bypass_list: event.target.value,
                                                    })
                                                }
                                                placeholder="localhost, 127.0.0.1, *.company.local"
                                                style={modalInputStyle()}
                                            />
                                            <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                                Comma separated hosts or wildcard suffixes.
                                            </span>
                                        </label>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {selectedTab === "about" && (
                        <div
                            style={{
                                minHeight: "100%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "8px 0",
                            }}
                        >
                            <div
                                style={{
                                    width: "100%",
                                    maxWidth: 520,
                                    display: "grid",
                                    gap: 18,
                                    justifyItems: "center",
                                    textAlign: "center",
                                    margin: "0 auto",
                                }}
                            >
                                <div style={{ display: "grid", gap: 10, justifyItems: "center" }}>
                                    <div
                                        style={{
                                            width: 84,
                                            height: 84,
                                            borderRadius: 22,
                                            border: "1px solid var(--pg-border)",
                                            background:
                                                "linear-gradient(180deg, rgba(var(--pg-primary-rgb), 0.16), rgba(255, 255, 255, 0.03))",
                                            display: "grid",
                                            placeItems: "center",
                                            boxShadow:
                                                "0 18px 34px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
                                        }}
                                    >
                                        <img
                                            src={bifrostLogo}
                                            alt="Bifrost logo"
                                            style={{ width: 54, height: 54, display: "block" }}
                                        />
                                    </div>
                                    <div style={{ display: "grid", gap: 4 }}>
                                        <div
                                            style={{
                                                fontSize: 24,
                                                fontWeight: 800,
                                                color: "var(--pg-text)",
                                                letterSpacing: -0.4,
                                            }}
                                        >
                                            Bifrost
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 13,
                                                color: "var(--pg-text-muted)",
                                                lineHeight: 1.5,
                                            }}
                                        >
                                            Modern API client built with Tauri
                                        </div>
                                    </div>
                                </div>

                                <div
                                    style={{
                                        width: "100%",
                                        display: "grid",
                                        gap: 8,
                                        padding: 14,
                                        borderRadius: 14,
                                        border: "1px solid var(--pg-border)",
                                        background: "var(--pg-surface-0)",
                                    }}
                                >
                                    {[
                                        {
                                            label: "Version",
                                            value: aboutInfo?.version ?? "Loading...",
                                        },
                                        {
                                            label: "Architecture",
                                            value: aboutInfo?.architecture ?? "Loading...",
                                        },
                                        {
                                            label: "Platform",
                                            value: aboutInfo?.platform ?? "Loading...",
                                        },
                                        {
                                            label: "Runtime",
                                            value: aboutInfo?.runtime ?? "Loading...",
                                        },
                                    ].map((item) => (
                                        <div
                                            key={item.label}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                gap: 12,
                                                padding: "7px 0",
                                                borderBottom:
                                                    item.label === "Runtime"
                                                        ? "none"
                                                        : "1px solid var(--pg-border-soft)",
                                            }}
                                        >
                                            <span
                                                style={{
                                                    fontSize: 12,
                                                    fontWeight: 700,
                                                    color: "var(--pg-text-muted)",
                                                    letterSpacing: 0.24,
                                                }}
                                            >
                                                {item.label}
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: 13,
                                                    fontWeight: 600,
                                                    color: "var(--pg-text)",
                                                }}
                                            >
                                                {item.value}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                <div
                                    style={{
                                        display: "flex",
                                        flexWrap: "wrap",
                                        justifyContent: "center",
                                        gap: 10,
                                    }}
                                >
                                    <button
                                        type="button"
                                        onClick={() => void openUrl("https://github.com/GuerL/bifrost")}
                                        style={buttonStyle(false)}
                                    >
                                        GitHub
                                    </button>
                                    <button type="button" disabled style={buttonStyle(true)}>
                                        Documentation
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            void openUrl("https://github.com/GuerL/bifrost/issues/new")
                                        }
                                        style={buttonStyle(false)}
                                    >
                                        Report an Issue
                                    </button>
                                </div>

                                {aboutInfoError && (
                                    <div style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                        {aboutInfoError}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
