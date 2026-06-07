import { useEffect, useMemo, useState } from "react";
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
    primaryButtonStyle,
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
    const shortcuts = useMemo(() => listShortcuts(), []);
    const proxySettings = appSettings.proxy;
    const activeThemeLabel = formatThemeLabel(theme, systemTheme);

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
                <div style={{ ...sectionCardStyle, borderColor: "rgba(220, 38, 38, 0.45)" }}>
                    <div style={{ ...fieldCaptionStyle, color: "var(--pg-danger)" }}>
                        Proxy resolution unavailable
                    </div>
                    <div style={{ fontSize: 13, color: "var(--pg-text-dim)" }}>
                        {proxyPreviewError}
                    </div>
                </div>
            );
        }

        if (!proxyPreview) {
            return (
                <div style={sectionCardStyle}>
                    <div style={fieldCaptionStyle}>Active transport</div>
                    <div style={{ fontSize: 13, color: "var(--pg-text-dim)" }}>
                        Proxy resolution updates when the request URL is valid.
                    </div>
                </div>
            );
        }

        return (
            <div style={sectionCardStyle}>
                <div style={fieldCaptionStyle}>Active transport</div>
                <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--pg-text)" }}>
                        {proxyPreview.summary}
                    </div>
                    {proxyPreview.proxy_url && (
                        <div
                            style={{
                                fontFamily: '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, monospace',
                                fontSize: 12,
                                color: "var(--pg-text-dim)",
                            }}
                        >
                            {proxyPreview.proxy_url}
                        </div>
                    )}
                    {proxyPreview.detail && (
                        <div style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                            {proxyPreview.detail}
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
                        <div style={sectionCardStyle}>
                            <div style={fieldCaptionStyle}>Theme</div>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                                    gap: 10,
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
                                                padding: 14,
                                                textAlign: "left",
                                                cursor: "pointer",
                                                display: "grid",
                                                gap: 6,
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
                                                <span style={{ fontSize: 14, fontWeight: 700 }}>
                                                    {option.label}
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: 11,
                                                        color: active
                                                            ? "var(--pg-primary)"
                                                            : "var(--pg-text-muted)",
                                                    }}
                                                >
                                                    {active ? "Active" : ""}
                                                </span>
                                            </div>
                                            <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
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
                        <>
                            {renderProxyPreview()}
                            <div style={sectionCardStyle}>
                                <label
                                    style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 10,
                                        cursor: "pointer",
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={proxySettings.use_system_proxy}
                                        onChange={(event) =>
                                            updateProxySettings({
                                                use_system_proxy: event.target.checked,
                                            })
                                        }
                                    />
                                    <span style={{ display: "grid", gap: 4 }}>
                                        <span style={{ fontSize: 13, fontWeight: 700 }}>Use system proxy</span>
                                        <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                            Uses operating system proxy configuration. On Linux this follows
                                            platform defaults.
                                        </span>
                                    </span>
                                </label>

                                <label
                                    style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 10,
                                        cursor: "pointer",
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={proxySettings.respect_environment_variables}
                                        onChange={(event) =>
                                            updateProxySettings({
                                                respect_environment_variables: event.target.checked,
                                            })
                                        }
                                    />
                                    <span style={{ display: "grid", gap: 4 }}>
                                        <span style={{ fontSize: 13, fontWeight: 700 }}>
                                            Respect environment variables
                                        </span>
                                        <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                            Reads <code>HTTP_PROXY</code>, <code>HTTPS_PROXY</code>, and{" "}
                                            <code>NO_PROXY</code>.
                                        </span>
                                    </span>
                                </label>
                            </div>

                            <div style={sectionCardStyle}>
                                <label
                                    style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 10,
                                        cursor: "pointer",
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={proxySettings.use_custom_proxy}
                                        onChange={(event) =>
                                            updateProxySettings({
                                                use_custom_proxy: event.target.checked,
                                            })
                                        }
                                    />
                                    <span style={{ display: "grid", gap: 4 }}>
                                        <span style={{ fontSize: 13, fontWeight: 700 }}>Use custom proxy</span>
                                        <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                            Highest priority. If the selected protocol applies, it overrides
                                            system and environment proxy sources.
                                        </span>
                                    </span>
                                </label>

                                {proxySettings.use_custom_proxy && (
                                    <div style={{ display: "grid", gap: 12 }}>
                                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
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
                                                <span>HTTP</span>
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
                                                <span>HTTPS</span>
                                            </label>
                                        </div>

                                        <div
                                            style={{
                                                display: "grid",
                                                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                                                gap: 12,
                                            }}
                                        >
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
                                            </label>
                                        </div>

                                        <label
                                            style={{
                                                display: "flex",
                                                alignItems: "flex-start",
                                                gap: 10,
                                                cursor: "pointer",
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={proxySettings.custom.requires_authentication}
                                                onChange={(event) =>
                                                    updateCustomProxySettings({
                                                        requires_authentication: event.target.checked,
                                                    })
                                                }
                                            />
                                            <span style={{ display: "grid", gap: 4 }}>
                                                <span style={{ fontSize: 13, fontWeight: 700 }}>
                                                    Proxy requires authentication
                                                </span>
                                                <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                                    Credentials are stored with the global proxy settings.
                                                </span>
                                            </span>
                                        </label>

                                        {proxySettings.custom.requires_authentication && (
                                            <div
                                                style={{
                                                    display: "grid",
                                                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                                                    gap: 12,
                                                }}
                                            >
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
                        </>
                    )}

                    {selectedTab === "about" && (
                        <>
                            <div style={sectionCardStyle}>
                                <div style={fieldCaptionStyle}>Bifrost</div>
                                <div style={{ fontSize: 13, color: "var(--pg-text-dim)", lineHeight: 1.6 }}>
                                    Centralized settings now live in one modal so additional categories can
                                    be added without changing the rest of the workspace layout.
                                </div>
                            </div>
                            <div style={sectionCardStyle}>
                                <div style={fieldCaptionStyle}>Current configuration</div>
                                <div style={{ display: "grid", gap: 8 }}>
                                    <div style={{ fontSize: 13, color: "var(--pg-text)" }}>
                                        Theme: <strong>{activeThemeLabel}</strong>
                                    </div>
                                    <div style={{ fontSize: 13, color: "var(--pg-text)" }}>
                                        Proxy mode preview:{" "}
                                        <strong>{proxyPreview?.summary ?? "Direct connection"}</strong>
                                    </div>
                                </div>
                                <div>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedTab("proxy")}
                                        style={primaryButtonStyle(false)}
                                    >
                                        Open proxy settings
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
