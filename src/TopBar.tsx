import { CollectionMeta, Environment } from "./types.ts";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
    onManageEnvironments: () => void;
    onSaveDraft: () => void;
    onNewRequest: () => void;
    onOpenRawJson: () => void;
    canSaveDraft: boolean;
    hasDraft: boolean;
};

export default function TopBar({
                                   collections,
                                   currentCollectionId,
                                   environments,
                                   currentEnvironmentId,
                                   onSelectCollection,
                                   onSelectEnvironment,
                                   onManageEnvironments,
                                   onSaveDraft,
                                   onNewRequest,
                                   onOpenRawJson,
                                   canSaveDraft,
                                   hasDraft,
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
                borderBottom: "1px solid #1f2937",
                background: "linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(2,6,23,0.98) 100%)",
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
                            style={windowButtonStyle("#fca5a5", "#7f1d1d")}
                        >
                            ✕
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

function buttonStyle(disabled: boolean): React.CSSProperties {
    return {
        height: 34,
        padding: "0 12px",
        borderRadius: 10,
        border: "1px solid #334155",
        background: disabled ? "#1f2937" : "linear-gradient(180deg, #1f2937 0%, #111827 100%)",
        color: disabled ? "#6b7280" : "#f8fafc",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 600,
        boxShadow: disabled ? "none" : "0 8px 20px rgba(2, 6, 23, 0.2)",
    };
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
    return {
        height: 34,
        padding: "0 14px",
        borderRadius: 10,
        border: "1px solid #2563eb",
        background: disabled ? "#1e3a8a" : "linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)",
        color: "#ffffff",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 600,
        boxShadow: disabled ? "none" : "0 10px 24px rgba(37, 99, 235, 0.35)",
    };
}

function windowButtonStyle(
    color = "#f4f4f5",
    borderColor = "#3a3a3c"
): React.CSSProperties {
    return {
        width: 32,
        height: 30,
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        background: "linear-gradient(180deg, #1f2937 0%, #111827 100%)",
        color,
        cursor: "pointer",
        lineHeight: 1,
        padding: 0,
        boxShadow: "0 8px 20px rgba(2, 6, 23, 0.2)",
    };
}

function topbarSelectStyle(): React.CSSProperties {
    return {
        height: 34,
        minWidth: 180,
        borderRadius: 10,
        border: "1px solid #334155",
        background: "#0f172a",
        color: "#f8fafc",
        padding: "0 10px",
        outline: "none",
    };
}
