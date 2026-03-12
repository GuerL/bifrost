import { CollectionMeta, Environment } from "./types.ts";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
    buttonStyle,
    primaryButtonStyle,
    topbarSelectStyle,
    windowButtonStyle,
} from "./helpers/UiStyles.ts";

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
    onNewRequest: () => void;
    onOpenRawJson: () => void;
    onOpenCollectionRunner: () => void;
    canSaveDraft: boolean;
    hasDraft: boolean;
    canOpenCollectionRunner: boolean;
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
    onNewRequest,
    onOpenRawJson,
    onOpenCollectionRunner,
    canSaveDraft,
    hasDraft,
    canOpenCollectionRunner,
    isCollectionRunning,
                               }: TopBarProps) {
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

                <select
                    value={currentCollectionId ?? ""}
                    onChange={(e) => onSelectCollection(e.target.value)}
                    style={topbarSelectStyle()}
                >
                    <option value="">No collection</option>
                    {collections.map((collection) => (
                        <option key={collection.id} value={collection.id}>
                            {collection.name}
                        </option>
                    ))}
                </select>

                <select
                    value={currentEnvironmentId ?? ""}
                    onChange={(e) => onSelectEnvironment(e.target.value ? e.target.value : null)}
                    style={topbarSelectStyle()}
                >
                    {!currentEnvironmentId && <option value="">No environment</option>}
                    {environments.map((env) => (
                        <option key={env.id} value={env.id}>
                            {env.name}
                        </option>
                    ))}
                </select>


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
                <button
                    onClick={onManageCollections}
                    style={buttonStyle(false)}
                >
                    Collections
                </button>
                <button
                    onClick={onNewRequest}
                    disabled={!currentCollectionId}
                    style={buttonStyle(!currentCollectionId)}
                >
                    New Request
                </button>
                <button onClick={onManageEnvironments} style={buttonStyle(false)}>
                    Environments
                </button>
                <button
                    onClick={onSaveDraft}
                    disabled={!canSaveDraft}
                    style={primaryButtonStyle(!canSaveDraft)}
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
