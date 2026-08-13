import { useState } from "react";
import VariableInput, { type VariableStatus } from "./VariableInput.tsx";
import { buttonStyle } from "./helpers/UiStyles.ts";

type KeyValueRow = { key: string; value: string; enabled?: boolean };

type KeyValueTableProps = {
    rows: KeyValueRow[];
    onChange: (next: KeyValueRow[]) => void;
    resolveVariableStatus?: (name: string) => VariableStatus;
    resolveVariableValue?: (name: string) => string | undefined;
    variableSuggestions?: string[];
    showEnabledToggle?: boolean;
    enabledToggleTitle?: string;
    showDragHandle?: boolean;
    showTrailingEmptyRow?: boolean;
    disabled?: boolean;
};

function visibleRows(rows: KeyValueRow[], showTrailingEmptyRow: boolean): KeyValueRow[] {
    if (!showTrailingEmptyRow) return rows;
    return [
        ...rows,
        {
            key: "",
            value: "",
            enabled: true,
        },
    ];
}

function updateRow(rows: KeyValueRow[], index: number, patch: Partial<KeyValueRow>): KeyValueRow[] {
    if (index < rows.length) {
        const next = rows.slice();
        next[index] = { ...next[index], ...patch };
        return next;
    }

    return [
        ...rows,
        {
            key: "",
            value: "",
            enabled: true,
            ...patch,
        },
    ];
}

export default function KeyValueTable({
    rows,
    onChange,
    resolveVariableStatus,
    resolveVariableValue,
    variableSuggestions,
    showEnabledToggle,
    enabledToggleTitle,
    showDragHandle,
    showTrailingEmptyRow = false,
    disabled = false,
}: KeyValueTableProps) {
    const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const renderedRows = visibleRows(rows, showTrailingEmptyRow);
    const canDrag = !!showDragHandle && !disabled;

    return (
        <div style={{ display: "grid", gap: 8 }}>
            {renderedRows.map((kv, i) => {
                const isPlaceholder = i >= rows.length;
                const rowDisabled = kv.enabled === false;

                return (
                    <div
                        key={i}
                        draggable={canDrag && !isPlaceholder}
                        onDragStart={(event) => {
                            if (!canDrag || isPlaceholder) return;
                            setDraggingIndex(i);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("application/x-bifrost-row-index", String(i));
                        }}
                        onDragOver={(event) => {
                            if (!canDrag || isPlaceholder) return;
                            event.preventDefault();
                            setDragOverIndex(i);
                            event.dataTransfer.dropEffect = "move";
                        }}
                        onDragLeave={() => {
                            if (dragOverIndex === i) {
                                setDragOverIndex(null);
                            }
                        }}
                        onDrop={(event) => {
                            if (!canDrag || isPlaceholder) return;
                            event.preventDefault();
                            setDragOverIndex(null);
                            setDraggingIndex(null);
                            const from = Number(
                                event.dataTransfer.getData("application/x-bifrost-row-index")
                            );
                            if (!Number.isInteger(from) || from === i || from < 0 || from >= rows.length) {
                                return;
                            }
                            const next = rows.slice();
                            const [moved] = next.splice(from, 1);
                            next.splice(i, 0, moved);
                            onChange(next);
                        }}
                        onDragEnd={() => {
                            setDraggingIndex(null);
                            setDragOverIndex(null);
                        }}
                        style={{
                            display: "grid",
                            gridTemplateColumns: `${showDragHandle ? "24px " : ""}${showEnabledToggle ? "28px " : ""}minmax(0, 1fr) minmax(0, 1fr) 30px`,
                            gap: 8,
                            alignItems: "center",
                            opacity: rowDisabled ? 0.68 : 1,
                            borderTop:
                                dragOverIndex === i && draggingIndex !== null && draggingIndex !== i
                                    ? "2px solid var(--pg-primary)"
                                    : "2px solid transparent",
                            transform: draggingIndex === i ? "scale(0.995)" : "scale(1)",
                            transition:
                                "opacity 140ms ease, transform 140ms ease, background 140ms ease, border-color 140ms ease",
                        }}
                    >
                        {showDragHandle && (
                            <div
                                style={{
                                    width: 24,
                                    height: 28,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "var(--pg-text-muted)",
                                    cursor:
                                        canDrag && !isPlaceholder
                                            ? draggingIndex === i
                                                ? "grabbing"
                                                : "grab"
                                            : "default",
                                    userSelect: "none",
                                }}
                                title="Drag to reorder"
                            >
                                ⠿
                            </div>
                        )}
                        {showEnabledToggle && (
                            <label
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    minWidth: 28,
                                }}
                                title={enabledToggleTitle}
                            >
                                <input
                                    type="checkbox"
                                    checked={kv.enabled !== false}
                                    disabled={disabled || isPlaceholder}
                                    onChange={(event) => {
                                        onChange(updateRow(rows, i, { enabled: event.target.checked }));
                                    }}
                                />
                            </label>
                        )}
                        <VariableInput
                            placeholder="key"
                            value={kv.key}
                            onChange={(nextKey) => {
                                onChange(updateRow(rows, i, { key: nextKey }));
                            }}
                            resolveVariableStatus={resolveVariableStatus}
                            resolveVariableValue={resolveVariableValue}
                            variableSuggestions={variableSuggestions}
                            containerStyle={{ flex: 1 }}
                            disabled={disabled}
                        />
                        <VariableInput
                            placeholder="value"
                            value={kv.value}
                            onChange={(nextValue) => {
                                onChange(updateRow(rows, i, { value: nextValue }));
                            }}
                            resolveVariableStatus={resolveVariableStatus}
                            resolveVariableValue={resolveVariableValue}
                            variableSuggestions={variableSuggestions}
                            containerStyle={{ flex: 1 }}
                            disabled={disabled}
                        />
                        <button
                            onClick={() => {
                                if (isPlaceholder) return;
                                const next = rows.slice();
                                next.splice(i, 1);
                                onChange(next);
                            }}
                            disabled={disabled || isPlaceholder}
                            style={{
                                ...buttonStyle(disabled || isPlaceholder),
                                width: 30,
                                minWidth: 30,
                                padding: 0,
                                fontSize: 14,
                                lineHeight: 1,
                                flexShrink: 0,
                            }}
                            title="Remove row"
                        >
                            −
                        </button>
                    </div>
                );
            })}
            {!showTrailingEmptyRow && (
                <button
                    disabled={disabled}
                    onClick={() =>
                        onChange([
                            ...rows,
                            {
                                key: "",
                                value: "",
                                ...(showEnabledToggle ? { enabled: true } : {}),
                            },
                        ])
                    }
                    style={{
                        ...buttonStyle(disabled),
                        width: "fit-content",
                        paddingInline: 12,
                    }}
                >
                    + Add
                </button>
            )}
        </div>
    );
}
