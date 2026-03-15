import type { CollectionMeta } from "../types.ts";
import { countTreeRequestRefs } from "../helpers/CollectionTree.ts";
import {
    buttonStyle,
    dangerButtonStyle,
    modalInputStyle,
    primaryButtonStyle,
} from "../helpers/UiStyles.ts";
import ConfirmationModal from "./ConfirmationModal.tsx";

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
                            maxWidth: 880,
                            maxHeight: "82vh",
                            border: "1px solid var(--pg-border)",
                            borderRadius: 12,
                            background: "var(--pg-surface-1)",
                            padding: 14,
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                                <h3 style={{ margin: 0 }}>Collections</h3>
                                <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                    {collections.length} collection{collections.length > 1 ? "s" : ""}
                                </span>
                            </div>
                            <button onClick={onClose} style={buttonStyle(busy)}>
                                Close
                            </button>
                        </div>

                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "minmax(260px, 320px) minmax(0, 1fr)",
                                gap: 10,
                                minHeight: 0,
                            }}
                        >
                            <section
                                style={{
                                    border: "1px solid var(--pg-border)",
                                    borderRadius: 10,
                                    background: "var(--pg-surface-0)",
                                    padding: 10,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8,
                                    minHeight: 0,
                                }}
                            >
                                <div style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 700 }}>
                                    Create collection
                                </div>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <input
                                        value={createName}
                                        onChange={(e) => onCreateNameChange(e.target.value)}
                                        disabled={busy}
                                        placeholder="Team APIs"
                                        style={{ ...modalInputStyle(), flex: 1, minWidth: 0 }}
                                    />
                                    <button onClick={onCreate} disabled={busy} style={primaryButtonStyle(busy)}>
                                        {busy ? "..." : "Create"}
                                    </button>
                                </div>

                                <div
                                    style={{
                                        minHeight: 160,
                                        maxHeight: "52vh",
                                        overflowY: "auto",
                                        paddingRight: 2,
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 6,
                                    }}
                                >
                                    {collections.length === 0 && (
                                        <div style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                            No collection yet.
                                        </div>
                                    )}
                                    {collections.map((entry) => {
                                        const isSelected = entry.id === selectedCollectionId;
                                        const isActive = entry.id === activeCollectionId;
                                        const requestCount = countTreeRequestRefs(entry.items);

                                        return (
                                            <button
                                                key={entry.id}
                                                onClick={() => onPickCollection(entry.id)}
                                                style={{
                                                    width: "100%",
                                                    border: `1px solid ${isSelected ? "var(--pg-primary)" : "var(--pg-border)"}`,
                                                    borderRadius: 9,
                                                    background: isSelected
                                                        ? "rgba(var(--pg-primary-rgb), 0.13)"
                                                        : "var(--pg-surface-1)",
                                                    padding: "8px 9px",
                                                    textAlign: "left",
                                                    color: "var(--pg-text)",
                                                    cursor: "pointer",
                                                    boxShadow: "none",
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    gap: 4,
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        justifyContent: "space-between",
                                                        gap: 8,
                                                        alignItems: "center",
                                                        minWidth: 0,
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            fontSize: 12,
                                                            fontWeight: 700,
                                                            overflow: "hidden",
                                                            textOverflow: "ellipsis",
                                                            whiteSpace: "nowrap",
                                                        }}
                                                    >
                                                        {entry.name}
                                                    </span>
                                                    {isActive && (
                                                        <span
                                                            style={{
                                                                fontSize: 11,
                                                                color: "var(--pg-primary)",
                                                                fontWeight: 700,
                                                                flexShrink: 0,
                                                            }}
                                                        >
                                                            Active
                                                        </span>
                                                    )}
                                                </div>
                                                <span style={{ fontSize: 11, color: "var(--pg-text-muted)" }}>
                                                    {requestCount} request{requestCount > 1 ? "s" : ""}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>

                            <section
                                style={{
                                    border: "1px solid var(--pg-border)",
                                    borderRadius: 10,
                                    background: "var(--pg-surface-0)",
                                    padding: 10,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 10,
                                    minHeight: 0,
                                }}
                            >
                                {!selectedCollection && (
                                    <div style={{ color: "var(--pg-text-muted)", fontSize: 13 }}>
                                        Select a collection on the left to edit it.
                                    </div>
                                )}

                                {selectedCollection && (
                                    <>
                                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                            <span style={{ fontSize: 12, color: "var(--pg-text-muted)", fontWeight: 700 }}>
                                                Collection name
                                            </span>
                                            <input
                                                value={draftName}
                                                onChange={(e) => onDraftNameChange(e.target.value)}
                                                disabled={busy}
                                                style={modalInputStyle()}
                                            />
                                        </label>

                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                            <div
                                                style={{
                                                    border: "1px solid var(--pg-border)",
                                                    borderRadius: 8,
                                                    background: "var(--pg-surface-1)",
                                                    padding: "6px 8px",
                                                    fontSize: 12,
                                                    color: "var(--pg-text-muted)",
                                                }}
                                            >
                                                Requests: {countTreeRequestRefs(selectedCollection.items)}
                                            </div>
                                            <div
                                                style={{
                                                    border: "1px solid var(--pg-border)",
                                                    borderRadius: 8,
                                                    background: "var(--pg-surface-1)",
                                                    padding: "6px 8px",
                                                    fontSize: 12,
                                                    color: selectedIsActive ? "var(--pg-primary)" : "var(--pg-text-muted)",
                                                    fontWeight: selectedIsActive ? 700 : 500,
                                                }}
                                            >
                                                {selectedIsActive ? "Currently active" : "Not active"}
                                            </div>
                                        </div>

                                        <div style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                                            Collection id:{" "}
                                            <code style={{ color: "var(--pg-text)" }}>
                                                {selectedCollection.id}
                                            </code>
                                        </div>

                                        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
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
                                                    Save
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}

                                {error && <div style={{ color: "var(--pg-danger)", fontSize: 13 }}>{error}</div>}
                            </section>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmationModal
                open={!!deleteTarget}
                busy={busy}
                title="Delete collection"
                message={
                    deleteTarget
                        ? `Delete "${deleteTarget.name}"? This will remove all requests in this collection.`
                        : ""
                }
                confirmLabel="Delete"
                onCancel={onCancelDelete}
                onConfirm={onConfirmDelete}
            />
        </>
    );
}
