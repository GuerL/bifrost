import type { CollectionMeta } from "../types.ts";
import {
    buttonStyle,
    dangerButtonStyle,
    modalInputStyle,
    primaryButtonStyle,
} from "../helpers/UiStyles.ts";

type DeleteCollectionTarget = {
    id: string;
    name: string;
};

type CollectionsModalProps = {
    open: boolean;
    busy: boolean;
    error: string;
    collections: CollectionMeta[];
    activeCollectionId: string | null;
    selectedCollectionId: string | null;
    selectedCollection: CollectionMeta | null;
    createName: string;
    draftName: string;
    deleteTarget: DeleteCollectionTarget | null;
    onClose: () => void;
    onCreateNameChange: (value: string) => void;
    onDraftNameChange: (value: string) => void;
    onCreate: () => void;
    onPickCollection: (collectionId: string) => void;
    onSetActive: () => void;
    onRequestDelete: () => void;
    onSave: () => void;
    onCancelDelete: () => void;
    onConfirmDelete: () => void;
};

export default function CollectionsModal({
    open,
    busy,
    error,
    collections,
    activeCollectionId,
    selectedCollectionId,
    selectedCollection,
    createName,
    draftName,
    deleteTarget,
    onClose,
    onCreateNameChange,
    onDraftNameChange,
    onCreate,
    onPickCollection,
    onSetActive,
    onRequestDelete,
    onSave,
    onCancelDelete,
    onConfirmDelete,
}: CollectionsModalProps) {
    const selectedIsActive = selectedCollection?.id === activeCollectionId;

    return (
        <>
            {open && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 1380,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                    }}
                    onMouseDown={onClose}
                >
                    <div
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 920,
                            height: "78vh",
                            maxHeight: 700,
                            border: "1px solid var(--pg-border)",
                            borderRadius: 12,
                            background: "var(--pg-surface-1)",
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <h3 style={{ margin: 0 }}>Collections</h3>
                            <button onClick={onClose} style={buttonStyle(busy)}>
                                Close
                            </button>
                        </div>

                        <div style={{ display: "flex", gap: 12, minHeight: 0, flex: 1 }}>
                            <div
                                style={{
                                    width: 280,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 10,
                                    minHeight: 0,
                                }}
                            >
                                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    <span style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>New collection name</span>
                                    <input
                                        value={createName}
                                        onChange={(e) => onCreateNameChange(e.target.value)}
                                        disabled={busy}
                                        placeholder="Team APIs"
                                        style={modalInputStyle()}
                                    />
                                </label>
                                <button onClick={onCreate} disabled={busy} style={primaryButtonStyle(busy)}>
                                    {busy ? "Working..." : "Create Collection"}
                                </button>

                                <div style={{ overflowY: "auto", minHeight: 0, flex: 1, paddingRight: 4 }}>
                                    {collections.map((entry) => (
                                        <button
                                            key={entry.id}
                                            onClick={() => onPickCollection(entry.id)}
                                            style={{
                                                ...buttonStyle(false),
                                                width: "100%",
                                                marginBottom: 6,
                                                textAlign: "left",
                                                borderColor:
                                                    entry.id === selectedCollectionId
                                                        ? "var(--pg-primary)"
                                                        : "var(--pg-border)",
                                            }}
                                        >
                                            {entry.name}
                                            {entry.id === activeCollectionId ? " (active)" : ""}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div
                                style={{
                                    flex: 1,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 12,
                                    minHeight: 0,
                                }}
                            >
                                {!selectedCollection && (
                                    <div style={{ color: "var(--pg-text-muted)" }}>No collection selected.</div>
                                )}

                                {selectedCollection && (
                                    <>
                                        <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                                            Collection id:{" "}
                                            <code style={{ color: "var(--pg-text)" }}>
                                                {selectedCollection.id}
                                            </code>
                                        </div>

                                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                            <span style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>Collection name</span>
                                            <input
                                                value={draftName}
                                                onChange={(e) => onDraftNameChange(e.target.value)}
                                                disabled={busy}
                                                style={modalInputStyle()}
                                            />
                                        </label>

                                        <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                                            Requests: {selectedCollection.request_order.length}
                                        </div>

                                        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", gap: 8 }}>
                                            <button
                                                onClick={onSetActive}
                                                disabled={busy || selectedIsActive}
                                                style={buttonStyle(busy || selectedIsActive)}
                                            >
                                                Set Active
                                            </button>
                                            <div style={{ display: "flex", gap: 8 }}>
                                                <button
                                                    onClick={onRequestDelete}
                                                    disabled={busy}
                                                    style={dangerButtonStyle(busy)}
                                                >
                                                    Delete
                                                </button>
                                                <button onClick={onSave} disabled={busy} style={primaryButtonStyle(busy)}>
                                                    Save Collection
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}

                                {error && <div style={{ color: "var(--pg-danger)", fontSize: 13 }}>{error}</div>}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {deleteTarget && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 1390,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                    }}
                    onMouseDown={() => {
                        if (!busy) onCancelDelete();
                    }}
                >
                    <div
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 500,
                            border: "1px solid var(--pg-border)",
                            borderRadius: 12,
                            background: "var(--pg-surface-1)",
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                        }}
                    >
                        <h3 style={{ margin: 0 }}>Delete collection</h3>
                        <div style={{ fontSize: 13, color: "var(--pg-text-dim)", lineHeight: 1.5 }}>
                            Delete <strong>{deleteTarget.name}</strong>? This will remove all requests in this collection.
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button onClick={onCancelDelete} disabled={busy} style={buttonStyle(busy)}>
                                Cancel
                            </button>
                            <button onClick={onConfirmDelete} disabled={busy} style={dangerButtonStyle(busy)}>
                                {busy ? "Deleting..." : "Delete"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
