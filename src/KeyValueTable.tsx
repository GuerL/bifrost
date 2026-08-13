import { useEffect, useRef, useState } from "react";
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
    const [dragInsertIndex, setDragInsertIndex] = useState<number | null>(null);
    const rowElementsRef = useRef<Array<HTMLDivElement | null>>([]);
    const renderedRows = visibleRows(rows, showTrailingEmptyRow);
    const canDrag = !!showDragHandle && !disabled;

    function insertionIndexFromPointer(clientY: number): number {
        const rowElements = rowElementsRef.current.slice(0, rows.length);
        for (const [index, element] of rowElements.entries()) {
            if (!element) continue;
            const rect = element.getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) {
                return index;
            }
        }
        return rows.length;
    }

    useEffect(() => {
        if (draggingIndex === null) return;
        const sourceIndex = draggingIndex;

        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";

        function onPointerMove(event: PointerEvent) {
            setDragInsertIndex(insertionIndexFromPointer(event.clientY));
        }

        function onPointerUp(event: PointerEvent) {
            const nextInsertIndex = insertionIndexFromPointer(event.clientY);
            setDraggingIndex(null);
            setDragInsertIndex(null);

            if (
                sourceIndex < 0 ||
                sourceIndex >= rows.length ||
                nextInsertIndex === sourceIndex ||
                nextInsertIndex === sourceIndex + 1
            ) {
                return;
            }

            const next = rows.slice();
            const [moved] = next.splice(sourceIndex, 1);
            const adjustedInsertIndex =
                sourceIndex < nextInsertIndex ? nextInsertIndex - 1 : nextInsertIndex;
            next.splice(Math.max(0, Math.min(adjustedInsertIndex, next.length)), 0, moved);
            onChange(next);
        }

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);

        return () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousUserSelect;
        };
    }, [draggingIndex, onChange, rows]);

    return (
        <div style={{ display: "grid", gap: 8 }}>
            {renderedRows.map((kv, i) => {
                const isPlaceholder = i >= rows.length;
                const rowDisabled = kv.enabled === false;

                return (
                    <div
                        key={i}
                        ref={(element) => {
                            rowElementsRef.current[i] = isPlaceholder ? null : element;
                        }}
                        style={{
                            display: "grid",
                            gridTemplateColumns: `${showDragHandle ? "24px " : ""}${showEnabledToggle ? "28px " : ""}minmax(0, 1fr) minmax(0, 1fr) 30px`,
                            gap: 8,
                            alignItems: "center",
                            opacity: rowDisabled ? 0.68 : 1,
                            borderTop:
                                dragInsertIndex === i && draggingIndex !== null
                                    ? "2px solid var(--pg-primary)"
                                    : "2px solid transparent",
                            borderBottom:
                                dragInsertIndex === rows.length && i === rows.length - 1
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
                                onPointerDown={(event) => {
                                    if (!canDrag || isPlaceholder || event.button !== 0) return;
                                    event.preventDefault();
                                    setDraggingIndex(i);
                                    setDragInsertIndex(i);
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
