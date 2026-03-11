import { CollectionMeta, Environment } from "./types.ts";

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
    return (
        <div
            data-tauri-drag-region
            style={{
                height: 52,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingLeft: 88, // espace pour les traffic lights macOS
                paddingRight: 12,
                // background: "#1c1c1e",
                // borderBottom: "1px solid #2c2c2e",
                userSelect: "none",
                flexShrink: 0,
            }}
        >
            <div
                data-tauri-drag-region
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
                    style={{
                        height: 32,
                        minWidth: 180,
                        borderRadius: 8,
                        border: "1px solid #3a3a3c",
                        background: "#2c2c2e",
                        color: "#f4f4f5",
                        padding: "0 10px",
                        outline: "none",
                    }}
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
                    style={{
                        height: 32,
                        minWidth: 180,
                        borderRadius: 8,
                        border: "1px solid #3a3a3c",
                        background: "#2c2c2e",
                        color: "#f4f4f5",
                        padding: "0 10px",
                        outline: "none",
                    }}
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
            </div>
        </div>
    );
}

function buttonStyle(disabled: boolean): React.CSSProperties {
    return {
        height: 32,
        padding: "0 12px",
        borderRadius: 8,
        border: "1px solid #3a3a3c",
        background: disabled ? "#2a2a2a" : "#2c2c2e",
        color: disabled ? "#6b7280" : "#f4f4f5",
        cursor: disabled ? "not-allowed" : "pointer",
    };
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
    return {
        height: 32,
        padding: "0 12px",
        borderRadius: 8,
        border: "1px solid #2563eb",
        background: disabled ? "#1f2937" : "#2563eb",
        color: "#ffffff",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 600,
    };
}
