import { useEffect, useRef, useState, type CSSProperties } from "react";
import VariableInput, { type VariableStatus } from "./VariableInput.tsx";
import { buttonStyle } from "./helpers/UiStyles.ts";

type KeyValueRow = { key: string; value: string; enabled?: boolean };
const DRAG_DOT_COUNT = 6;

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

function dragHandleStyle(params: {
    canDrag: boolean;
    isActive: boolean;
    isPlaceholder: boolean;
    isHovering: boolean;
}): CSSProperties {
    const interactive = params.canDrag && !params.isPlaceholder;
    return {
        width: 24,
        height: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: params.isActive || params.isHovering ? "var(--pg-text)" : "var(--pg-text-muted)",
        cursor: interactive ? (params.isActive ? "grabbing" : "grab") : "default",
        userSelect: "none",
        borderRadius: 7,
        background:
            params.isActive || params.isHovering
                ? "rgba(var(--pg-primary-rgb), 0.14)"
                : "transparent",
        transition: "background 140ms ease, color 140ms ease, transform 140ms ease",
        transform: params.isActive ? "scale(1.03)" : "scale(1)",
    };
}

function DragGrip() {
    return (
        <span
            aria-hidden
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 3px)",
                gap: 3,
            }}
        >
            {Array.from({ length: DRAG_DOT_COUNT }, (_, index) => (
                <span
                    key={index}
                    style={{
                        width: 3,
                        height: 3,
                        borderRadius: 999,
                        background: "currentColor",
                    }}
                />
            ))}
        </span>
    );
}

function InsertionMarker({ position }: { position: "top" | "bottom" }) {
    return (
        <div
            aria-hidden
            style={{
                position: "absolute",
                left: 4,
                right: 4,
                [position]: -4,
                height: 8,
                pointerEvents: "none",
                display: "flex",
                alignItems: "center",
                zIndex: 1,
            }}
        >
            <span
                style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: "var(--pg-primary)",
                    boxShadow: "0 0 0 2px rgba(var(--pg-primary-rgb), 0.18)",
                    flexShrink: 0,
                }}
            />
            <span
                style={{
                    height: 2,
                    borderRadius: 999,
                    background: "var(--pg-primary)",
                    boxShadow: "0 0 10px rgba(var(--pg-primary-rgb), 0.34)",
                    flex: 1,
                }}
            />
        </div>
    );
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
    const [hoveredDragIndex, setHoveredDragIndex] = useState<number | null>(null);
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
                const rowDragging = draggingIndex === i;
                const showTopInsertLine = dragInsertIndex === i && draggingIndex !== null;
                const showBottomInsertLine =
                    dragInsertIndex === rows.length && i === rows.length - 1;

                return (
                    <div
                        key={i}
                        ref={(element) => {
                            rowElementsRef.current[i] = isPlaceholder ? null : element;
                        }}
                        style={{
                            position: "relative",
                            display: "grid",
                            gridTemplateColumns: `${showDragHandle ? "24px " : ""}${showEnabledToggle ? "28px " : ""}minmax(0, 1fr) minmax(0, 1fr) 30px`,
                            gap: 8,
                            alignItems: "center",
                            opacity: rowDisabled ? 0.68 : 1,
                            padding: "2px 0",
                            borderRadius: 8,
                            background: rowDragging
                                ? "rgba(var(--pg-primary-rgb), 0.08)"
                                : "transparent",
                            outline: rowDragging
                                ? "1px solid rgba(var(--pg-primary-rgb), 0.24)"
                                : "1px solid transparent",
                            transform: rowDragging ? "translateY(-1px)" : "translateY(0)",
                            transition:
                                "opacity 140ms ease, transform 140ms ease, background 140ms ease, outline-color 140ms ease",
                        }}
                    >
                        {showTopInsertLine && <InsertionMarker position="top" />}
                        {showBottomInsertLine && <InsertionMarker position="bottom" />}
                        {showDragHandle && (
                            <div
                                role="button"
                                aria-label="Drag to reorder"
                                style={dragHandleStyle({
                                    canDrag,
                                    isActive: rowDragging,
                                    isPlaceholder,
                                    isHovering: hoveredDragIndex === i,
                                })}
                                onPointerEnter={() => setHoveredDragIndex(i)}
                                onPointerLeave={() => {
                                    if (hoveredDragIndex === i) {
                                        setHoveredDragIndex(null);
                                    }
                                }}
                                onPointerDown={(event) => {
                                    if (!canDrag || isPlaceholder || event.button !== 0) return;
                                    event.preventDefault();
                                    event.currentTarget.setPointerCapture(event.pointerId);
                                    setDraggingIndex(i);
                                    setDragInsertIndex(i);
                                }}
                                title="Drag to reorder"
                            >
                                <DragGrip />
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
