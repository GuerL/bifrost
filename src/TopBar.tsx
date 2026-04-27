import { useEffect, useRef, useState } from "react";
import { CollectionMeta, Environment } from "./types.ts";
import { getCurrentWindow } from "@tauri-apps/api/window";
import bifrostLogo from "./assets/bifrost_logo.svg";
import {
    buttonStyle,
    primaryButtonStyle,
    windowButtonStyle,
} from "./helpers/UiStyles.ts";
import TopbarSelector, { type TopbarSelectorItem } from "./components/TopbarSelector.tsx";
import { type Theme, useTheme } from "./helpers/Theme.tsx";

const isMacOS =
    typeof navigator !== "undefined" &&
    /(Mac|iPhone|iPad|iPod)/i.test(navigator.userAgent);
const isWindows =
    typeof navigator !== "undefined" &&
    /Windows/i.test(navigator.userAgent);

type TopBarProps = {
    collections: CollectionMeta[];
    currentCollectionId: string | null;
    environments: Environment[];
    currentEnvironmentId: string | null;
    onSelectCollection: (collectionId: string) => void;
    onSelectEnvironment: (environmentId: string | null) => void;
    onManageCollections: () => void;
    onManageEnvironments: () => void;
    onSaveDraft: () => void;
    onOpenRawJson: () => void;
    onOpenCollectionRunner: () => void;
    onImportPostman: () => void;
    onImportPortable: () => void;
    onExportPortable: () => void;
    canSaveDraft: boolean;
    hasDraft: boolean;
    canOpenCollectionRunner: boolean;
    canExportCollection: boolean;
    isCollectionRunning: boolean;
};

export default function TopBar({
    collections,
    currentCollectionId,
    environments,
    currentEnvironmentId,
    onSelectCollection,
    onSelectEnvironment,
    onManageCollections,
    onManageEnvironments,
    onSaveDraft,
    onOpenRawJson,
    onOpenCollectionRunner,
    onImportPostman,
    onImportPortable,
    onExportPortable,
    canSaveDraft,
    hasDraft,
    canOpenCollectionRunner,
    canExportCollection,
    isCollectionRunning,
}: TopBarProps) {
    const { theme, resolvedTheme, setTheme } = useTheme();
    const [isTransferMenuOpen, setIsTransferMenuOpen] = useState(false);
    const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
    const transferMenuRef = useRef<HTMLDivElement | null>(null);
    const themeMenuRef = useRef<HTMLDivElement | null>(null);
    const saveDraftShortcutLabel = isMacOS ? "CMD + S" : "CTRL + S";
    const collectionSelectorItems: TopbarSelectorItem[] = collections.map((collection) => ({
        value: collection.id,
        label: collection.name,
    }));
    const environmentSelectorItems: TopbarSelectorItem[] = environments.map((environment) => ({
        value: environment.id,
        label: environment.name,
    }));

    useEffect(() => {
        if (!isTransferMenuOpen && !isThemeMenuOpen) {
            return;
        }

        function onPointerDown(event: MouseEvent) {
            if (event.target instanceof Node) {
                if (transferMenuRef.current?.contains(event.target)) {
                    return;
                }
                if (themeMenuRef.current?.contains(event.target)) {
                    return;
                }
            }
            setIsTransferMenuOpen(false);
            setIsThemeMenuOpen(false);
        }

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setIsTransferMenuOpen(false);
                setIsThemeMenuOpen(false);
            }
        }

        window.addEventListener("mousedown", onPointerDown);
        window.addEventListener("keydown", onKeyDown);

        return () => {
            window.removeEventListener("mousedown", onPointerDown);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [isThemeMenuOpen, isTransferMenuOpen]);

    async function runWindowAction(action: "minimize" | "toggleMaximize" | "close") {
        try {
            const win = getCurrentWindow();
            if (action === "minimize") {
                await win.minimize();
                return;
            }
            if (action === "toggleMaximize") {
                await win.toggleMaximize();
                return;
            }
            await win.close();
        } catch (error) {
            console.error(`Window action failed: ${action}`, error);
        }
    }

    function runTransferAction(action: "importPostman" | "importPortable" | "exportPortable") {
        setIsTransferMenuOpen(false);
        if (action === "importPostman") {
            onImportPostman();
            return;
        }
        if (action === "importPortable") {
            onImportPortable();
            return;
        }
        if (!canExportCollection) {
            return;
        }
        onExportPortable();
    }

    function runThemeAction(nextTheme: Theme) {
        setTheme(nextTheme);
        setIsThemeMenuOpen(false);
    }

    function transferMenuItemStyle(disabled = false) {
        return {
            width: "100%",
            border: "none",
            background: "transparent",
            color: disabled ? "var(--pg-text-muted)" : "var(--pg-text)",
            textAlign: "left" as const,
            padding: "6px 9px",
            borderRadius: 8,
            cursor: disabled ? "not-allowed" : "pointer",
            fontSize: 12,
        };
    }

    function themeMenuItemStyle(active: boolean) {
        return {
            ...transferMenuItemStyle(false),
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            background: active ? "rgba(var(--pg-primary-rgb), 0.16)" : "transparent",
            color: active ? "var(--pg-text)" : "var(--pg-text-dim)",
            fontWeight: active ? 700 : 600,
        };
    }

    return (
        <div
            data-tauri-drag-region
            style={{
                height: 52,
                display: "flex",
                alignItems: "center",
                gap: 12,
                paddingLeft: isMacOS ? 88 : 12, // space for macOS traffic lights
                paddingRight: 12,
                borderBottom: "1px solid var(--pg-border)",
                background: "var(--pg-surface-0)",
                userSelect: "none",
                flexShrink: 0,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    minWidth: 0,
                }}
            >
                <div
                    data-tauri-drag-region
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginRight: 2,
                    }}
                >
                    <img
                        src={bifrostLogo}
                        alt="Bifrost logo"
                        style={{
                            width: 26,
                            height: 26,
                            objectFit: "contain",
                            display: "block",
                        }}
                    />
                    <span
                        style={{
                            fontSize: 14,
                            fontWeight: 700,
                            color: "var(--pg-text)",
                            letterSpacing: 0.2,
                        }}
                    >
                        Bifrost
                    </span>
                </div>
                <TopbarSelector
                    icon={<FolderGlyph />}
                    value={currentCollectionId}
                    items={collectionSelectorItems}
                    onSelect={(collectionId) => onSelectCollection(collectionId ?? "")}
                    onManage={onManageCollections}
                    manageLabel="Manage Collections"
                    placeholder="No collection"
                    emptyOptionLabel="No collection"
                    width={224}
                    ariaLabel="Select collection"
                />

                <TopbarSelector
                    icon={<GlobeGlyph />}
                    value={currentEnvironmentId}
                    items={environmentSelectorItems}
                    onSelect={onSelectEnvironment}
                    onManage={onManageEnvironments}
                    manageLabel="Manage Environments"
                    placeholder="No environment"
                    emptyOptionLabel="No environment"
                    width={210}
                    ariaLabel="Select environment"
                />
            </div>

            <div
                data-tauri-drag-region
                style={{
                    flex: 1,
                    minWidth: 40,
                    height: "100%",
                }}
            />

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                }}
            >
                <button
                    onClick={onOpenRawJson}
                    disabled={!hasDraft}
                    style={buttonStyle(!hasDraft)}
                >
                    Raw JSON
                </button>
                <button
                    onClick={onOpenCollectionRunner}
                    disabled={!canOpenCollectionRunner}
                    style={
                        isCollectionRunning
                            ? primaryButtonStyle(false)
                            : buttonStyle(!canOpenCollectionRunner)
                    }
                >
                    {isCollectionRunning ? "Runner • Running" : "Runner"}
                </button>
                <div ref={themeMenuRef} style={{ position: "relative" }}>
                    <button
                        onClick={() => {
                            setIsTransferMenuOpen(false);
                            setIsThemeMenuOpen((open) => !open);
                        }}
                        style={buttonStyle(false)}
                        aria-haspopup="menu"
                        aria-expanded={isThemeMenuOpen}
                        title={`Theme: ${themeLabel(theme, resolvedTheme)}`}
                    >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            {themeIcon(theme)}
                            Theme ▾
                        </span>
                    </button>
                    {isThemeMenuOpen && (
                        <div
                            role="menu"
                            style={{
                                position: "absolute",
                                top: "calc(100% + 6px)",
                                right: 0,
                                minWidth: 186,
                                display: "flex",
                                flexDirection: "column",
                                gap: 2,
                                border: "1px solid var(--pg-border)",
                                borderRadius: 10,
                                padding: 6,
                                background: "var(--pg-surface-0)",
                                boxShadow: "0 8px 24px var(--pg-shadow-color)",
                                zIndex: 40,
                            }}
                        >
                            <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={theme === "light"}
                                onClick={() => runThemeAction("light")}
                                style={themeMenuItemStyle(theme === "light")}
                            >
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                    <SunThemeIcon />
                                    Light
                                </span>
                                {theme === "light" ? "✓" : ""}
                            </button>
                            <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={theme === "dark"}
                                onClick={() => runThemeAction("dark")}
                                style={themeMenuItemStyle(theme === "dark")}
                            >
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                    <MoonThemeIcon />
                                    Dark
                                </span>
                                {theme === "dark" ? "✓" : ""}
                            </button>
                            <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={theme === "system"}
                                onClick={() => runThemeAction("system")}
                                style={themeMenuItemStyle(theme === "system")}
                            >
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                    <SystemThemeIcon />
                                    System ({resolvedTheme})
                                </span>
                                {theme === "system" ? "✓" : ""}
                            </button>
                        </div>
                    )}
                </div>
                <div ref={transferMenuRef} style={{ position: "relative" }}>
                    <button
                        onClick={() => {
                            setIsThemeMenuOpen(false);
                            setIsTransferMenuOpen((open) => !open);
                        }}
                        style={buttonStyle(false)}
                        aria-haspopup="menu"
                        aria-expanded={isTransferMenuOpen}
                    >
                        Import/Export ▾
                    </button>
                    {isTransferMenuOpen && (
                        <div
                            role="menu"
                            style={{
                                position: "absolute",
                                top: "calc(100% + 6px)",
                                right: 0,
                                minWidth: 190,
                                display: "flex",
                                flexDirection: "column",
                                gap: 2,
                                border: "1px solid var(--pg-border)",
                                borderRadius: 10,
                                padding: 6,
                                background: "var(--pg-surface-0)",
                                boxShadow: "0 8px 24px var(--pg-shadow-color)",
                                zIndex: 40,
                            }}
                        >
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => runTransferAction("importPostman")}
                                style={transferMenuItemStyle()}
                            >
                                Import Postman
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => runTransferAction("importPortable")}
                                style={transferMenuItemStyle()}
                            >
                                Import Bifrost
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => runTransferAction("exportPortable")}
                                disabled={!canExportCollection}
                                style={transferMenuItemStyle(!canExportCollection)}
                            >
                                Export Bifrost
                            </button>
                        </div>
                    )}
                </div>
                <button
                    onClick={onSaveDraft}
                    disabled={!canSaveDraft}
                    style={primaryButtonStyle(!canSaveDraft)}
                    title={`Save draft (${saveDraftShortcutLabel})`}
                >
                    Save draft
                </button>
                {isWindows && (
                    <>
                        <button onClick={() => void runWindowAction("minimize")} style={windowButtonStyle()}>
                            —
                        </button>
                        <button onClick={() => void runWindowAction("toggleMaximize")} style={windowButtonStyle()}>
                            □
                        </button>
                        <button
                            onClick={() => void runWindowAction("close")}
                            style={windowButtonStyle("var(--pg-danger)", "var(--pg-danger-dark)")}
                        >
                            ✕
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

function FolderGlyph() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
                d="M3.75 7.75C3.75 6.7835 4.5335 6 5.5 6H9.513C10.0824 6 10.6164 6.2717 10.95 6.7315L11.75 7.8333C12.0836 8.2931 12.6176 8.5648 13.187 8.5648H18.5C19.4665 8.5648 20.25 9.3483 20.25 10.3148V16.5C20.25 17.4665 19.4665 18.25 18.5 18.25H5.5C4.5335 18.25 3.75 17.4665 3.75 16.5V7.75Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function GlobeGlyph() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.7" />
            <path
                d="M3.75 12H20.25M12 3.75C14.2792 6.2292 14.2792 17.7708 12 20.25M12 3.75C9.7208 6.2292 9.7208 17.7708 12 20.25"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
            />
        </svg>
    );
}

function themeLabel(theme: Theme, resolvedTheme: "light" | "dark"): string {
    if (theme === "system") {
        return `System (${resolvedTheme})`;
    }
    return theme === "dark" ? "Dark" : "Light";
}

function themeIcon(theme: Theme) {
    if (theme === "light") return <SunThemeIcon />;
    if (theme === "dark") return <MoonThemeIcon />;
    return <SystemThemeIcon />;
}

function SunThemeIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
            <path
                d="M12 2.75V5.25M12 18.75V21.25M21.25 12H18.75M5.25 12H2.75M18.55 5.45L16.78 7.22M7.22 16.78L5.45 18.55M18.55 18.55L16.78 16.78M7.22 7.22L5.45 5.45"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
            />
        </svg>
    );
}

function MoonThemeIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
                d="M18.4 14.9C17.35 15.44 16.16 15.75 14.9 15.75C10.74 15.75 7.35 12.36 7.35 8.2C7.35 6.94 7.66 5.75 8.2 4.7C5.23 6.06 3.17 9.06 3.17 12.53C3.17 17.28 7.02 21.13 11.77 21.13C15.24 21.13 18.24 19.07 19.6 16.1C19.2 15.76 18.8 15.34 18.4 14.9Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function SystemThemeIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="3.5" y="4.5" width="17" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
            <path d="M9 20H15M12 16.5V20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
    );
}
