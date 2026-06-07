import { useEffect, useRef, useState } from "react";
import { CollectionMeta, Environment } from "./types.ts";
import { getCurrentWindow } from "@tauri-apps/api/window";
import bifrostLogo from "./assets/bifrost_logo.svg";
import {
    buttonStyle,
    primaryButtonStyle,
    windowButtonStyle,
} from "./helpers/UiStyles.ts";
import { shortcutLabel } from "./helpers/ShortcutRegistry.ts";
import TopbarSelector, { type TopbarSelectorItem } from "./components/TopbarSelector.tsx";

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
    onOpenSettings: () => void;
    onOpenImport: () => void;
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
    onOpenSettings,
    onOpenImport,
    onExportPortable,
    canSaveDraft,
    hasDraft,
    canOpenCollectionRunner,
    canExportCollection,
    isCollectionRunning,
}: TopBarProps) {
    const [isTransferMenuOpen, setIsTransferMenuOpen] = useState(false);
    const transferMenuRef = useRef<HTMLDivElement | null>(null);
    const collectionSelectorItems: TopbarSelectorItem[] = collections.map((collection) => ({
        value: collection.id,
        label: collection.name,
    }));
    const environmentSelectorItems: TopbarSelectorItem[] = environments.map((environment) => ({
        value: environment.id,
        label: environment.name,
    }));

    useEffect(() => {
        if (!isTransferMenuOpen) {
            return;
        }

        function onPointerDown(event: MouseEvent) {
            if (event.target instanceof Node) {
                if (transferMenuRef.current?.contains(event.target)) {
                    return;
                }
            }
            setIsTransferMenuOpen(false);
        }

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setIsTransferMenuOpen(false);
            }
        }

        window.addEventListener("mousedown", onPointerDown);
        window.addEventListener("keydown", onKeyDown);

        return () => {
            window.removeEventListener("mousedown", onPointerDown);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [isTransferMenuOpen]);

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

    function runTransferAction(action: "openImport" | "exportPortable") {
        setIsTransferMenuOpen(false);
        if (action === "openImport") {
            onOpenImport();
            return;
        }
        if (!canExportCollection) {
            return;
        }
        onExportPortable();
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

    return (
        <div
            className="pg-topbar pg-topbar-drag"
            data-tauri-drag-region
            style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
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
                    className="pg-topbar-drag"
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
                <div className="pg-topbar-no-drag" style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                className="pg-topbar-no-drag"
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
                <button
                    onClick={() => {
                        setIsTransferMenuOpen(false);
                        onOpenSettings();
                    }}
                    style={buttonStyle(false)}
                >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <SettingsGlyph />
                        Settings
                    </span>
                </button>
                <div ref={transferMenuRef} style={{ position: "relative" }}>
                    <button
                        onClick={() => {
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
                                onClick={() => runTransferAction("openImport")}
                                style={transferMenuItemStyle()}
                            >
                                Import...
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
                    title={`Save draft (${shortcutLabel("saveDraft")})`}
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

function SettingsGlyph() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
                d="M12 8.9A3.1 3.1 0 1 0 12 15.1A3.1 3.1 0 1 0 12 8.9Z"
                stroke="currentColor"
                strokeWidth="1.8"
            />
            <path
                d="M4.7 13.14L3.5 12L4.7 10.86L5.06 9.31L6.61 8.95L7.75 7.75L9.3 8.11L10.44 7.75L12 6.55L13.56 7.75L14.7 8.11L16.25 7.75L17.39 8.95L18.94 9.31L19.3 10.86L20.5 12L19.3 13.14L18.94 14.69L17.39 15.05L16.25 16.25L14.7 15.89L13.56 16.25L12 17.45L10.44 16.25L9.3 15.89L7.75 16.25L6.61 15.05L5.06 14.69L4.7 13.14Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
            />
        </svg>
    );
}
