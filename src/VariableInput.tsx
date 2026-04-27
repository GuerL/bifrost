import { useEffect, useMemo, useRef, useState } from "react";

export type VariableStatus = "ok" | "missing";

type TextPart =
    | { kind: "text"; text: string }
    | { kind: "var"; text: string; name: string; status: VariableStatus };

type VariableMatch = {
    text: string;
    name: string;
    status: VariableStatus;
    start: number;
    end: number;
};

type CompletionContext = {
    openIndex: number;
    replaceEnd: number;
    query: string;
};

type HoverState = {
    left: number;
    top: number;
    match: VariableMatch;
    resolvedValue?: string;
};

type VariableInputProps = {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    resolveVariableStatus?: (name: string) => VariableStatus;
    resolveVariableValue?: (name: string) => string | undefined;
    variableSuggestions?: string[];
    containerStyle?: React.CSSProperties;
    style?: React.CSSProperties;
};

const VARIABLE_PATTERN = /{{\s*([^{}]+?)\s*}}/g;

function parseVariableText(
    text: string,
    resolveVariableStatus?: (name: string) => VariableStatus
): { parts: TextPart[]; matches: VariableMatch[] } {
    if (!text) return { parts: [], matches: [] };

    const parts: TextPart[] = [];
    const matches: VariableMatch[] = [];
    VARIABLE_PATTERN.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = VARIABLE_PATTERN.exec(text)) !== null) {
        const matchStart = match.index;
        const matchText = match[0];
        const variableName = (match[1] ?? "").trim();
        const status = resolveVariableStatus?.(variableName) ?? "ok";

        if (matchStart > lastIndex) {
            parts.push({
                kind: "text",
                text: text.slice(lastIndex, matchStart),
            });
        }

        parts.push({
            kind: "var",
            text: matchText,
            name: variableName,
            status,
        });

        matches.push({
            text: matchText,
            name: variableName,
            status,
            start: matchStart,
            end: matchStart + matchText.length,
        });

        lastIndex = matchStart + matchText.length;
    }

    if (lastIndex < text.length) {
        parts.push({
            kind: "text",
            text: text.slice(lastIndex),
        });
    }

    return { parts, matches };
}

function getCompletionContext(text: string, caretIndex: number): CompletionContext | null {
    if (caretIndex < 0 || caretIndex > text.length) return null;

    const openIndex = text.lastIndexOf("{{", caretIndex);
    if (openIndex === -1 || caretIndex < openIndex + 2) return null;

    const insideSlice = text.slice(openIndex + 2, caretIndex);
    if (insideSlice.includes("{") || insideSlice.includes("}")) {
        return null;
    }

    const closeIndex = text.indexOf("}}", openIndex + 2);
    if (closeIndex !== -1 && caretIndex > closeIndex + 2) {
        return null;
    }

    return {
        openIndex,
        replaceEnd: closeIndex === -1 ? caretIndex : closeIndex + 2,
        query: insideSlice.trim().toLowerCase(),
    };
}

function variableValueLabel(status: VariableStatus, value?: string): string {
    if (status === "missing") return "Variable not found in active environment.";
    if (value === undefined) return "No value available.";
    if (value.length === 0) return 'Resolved value: "" (empty string)';
    return `Resolved value: ${value}`;
}

export default function VariableInput({
    value,
    onChange,
    placeholder,
    disabled,
    resolveVariableStatus,
    resolveVariableValue,
    variableSuggestions,
    containerStyle,
    style,
}: VariableInputProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const overlayContentRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const pendingCaretRef = useRef<number | null>(null);

    const [isFocused, setIsFocused] = useState(false);
    const [caretIndex, setCaretIndex] = useState(0);
    const [completionDismissed, setCompletionDismissed] = useState(false);
    const [selectedCompletionIndex, setSelectedCompletionIndex] = useState(0);
    const [hoverState, setHoverState] = useState<HoverState | null>(null);
    const sharedTextStyle: React.CSSProperties = {
        padding: "0.6em 0.9em",
        fontFamily: "inherit",
        fontSize: "0.80em",
        fontWeight: 200,
        lineHeight: 1.11,
        letterSpacing: "normal",
    };

    const { parts, matches } = useMemo(
        () => parseVariableText(value, resolveVariableStatus),
        [value, resolveVariableStatus]
    );

    const completionContext = useMemo(
        () => getCompletionContext(value, caretIndex),
        [value, caretIndex]
    );

    const completionItems = useMemo(() => {
        if (!completionContext || !variableSuggestions?.length) return [];

        const uniqueNames = Array.from(
            new Set(
                variableSuggestions
                    .map((name) => name.trim())
                    .filter((name) => name.length > 0)
            )
        ).sort((a, b) => a.localeCompare(b));

        if (!completionContext.query) return uniqueNames;

        return uniqueNames.filter((name) =>
            name.toLowerCase().includes(completionContext.query)
        );
    }, [completionContext, variableSuggestions]);

    const showCompletions =
        !disabled &&
        isFocused &&
        !completionDismissed &&
        completionContext !== null &&
        completionItems.length > 0;

    useEffect(() => {
        if (!showCompletions) {
            setSelectedCompletionIndex(0);
            return;
        }
        setSelectedCompletionIndex((prev) => Math.min(prev, completionItems.length - 1));
    }, [showCompletions, completionItems.length]);

    useEffect(() => {
        const pendingCaret = pendingCaretRef.current;
        if (pendingCaret == null) return;
        pendingCaretRef.current = null;

        requestAnimationFrame(() => {
            const input = inputRef.current;
            if (!input) return;
            input.focus();
            input.setSelectionRange(pendingCaret, pendingCaret);
            setCaretIndex(pendingCaret);
        });
    }, [value]);

    function syncScroll(scrollLeft: number) {
        if (!overlayContentRef.current) return;
        overlayContentRef.current.style.transform = `translateX(${-scrollLeft}px)`;
    }

    function syncCaretFromInput() {
        const input = inputRef.current;
        if (!input) return;
        setCaretIndex(input.selectionStart ?? value.length);
        setCompletionDismissed(false);
    }

    function applyCompletion(name: string) {
        const input = inputRef.current;
        if (!input) return;

        const context = getCompletionContext(value, input.selectionStart ?? value.length);
        if (!context) return;

        const replacement = `{{${name}}}`;
        const before = value.slice(0, context.openIndex);
        const after = value.slice(context.replaceEnd);
        pendingCaretRef.current = before.length + replacement.length;
        onChange(`${before}${replacement}${after}`);
        setCompletionDismissed(true);
    }

    function characterIndexAtPointer(clientX: number): number {
        const input = inputRef.current;
        if (!input) return 0;

        const rect = input.getBoundingClientRect();
        const styleInfo = window.getComputedStyle(input);
        const paddingLeft = Number.parseFloat(styleInfo.paddingLeft) || 0;
        const spacingRaw = Number.parseFloat(styleInfo.letterSpacing);
        const letterSpacing = Number.isFinite(spacingRaw) ? spacingRaw : 0;
        const relativeX = clientX - rect.left + input.scrollLeft - paddingLeft;
        if (relativeX <= 0) return 0;

        const canvas = measureCanvasRef.current ?? document.createElement("canvas");
        measureCanvasRef.current = canvas;
        const ctx = canvas.getContext("2d");
        if (!ctx) return 0;
        ctx.font = styleInfo.font;

        let low = 0;
        let high = value.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            const measured = value.slice(0, mid);
            const width = ctx.measureText(measured).width + Math.max(0, mid - 1) * letterSpacing;
            if (width <= relativeX) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        return low;
    }

    function onMouseMoveInput(e: React.MouseEvent<HTMLInputElement>) {
        if (matches.length === 0) {
            setHoverState(null);
            return;
        }
        const container = containerRef.current;
        if (!container) return;

        const charIndex = characterIndexAtPointer(e.clientX);
        const hoveredMatch =
            matches.find((entry) => charIndex >= entry.start && charIndex <= entry.end) ?? null;

        if (!hoveredMatch) {
            setHoverState(null);
            return;
        }

        const containerRect = container.getBoundingClientRect();
        setHoverState({
            left: e.clientX - containerRect.left + 10,
            top: e.clientY - containerRect.top + 18,
            match: hoveredMatch,
            resolvedValue: resolveVariableValue?.(hoveredMatch.name),
        });
    }

    function onKeyDownInput(e: React.KeyboardEvent<HTMLInputElement>) {
        if (!showCompletions) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedCompletionIndex((prev) => (prev + 1) % completionItems.length);
            return;
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedCompletionIndex((prev) =>
                prev === 0 ? completionItems.length - 1 : prev - 1
            );
            return;
        }

        if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const picked = completionItems[selectedCompletionIndex] ?? completionItems[0];
            if (picked) applyCompletion(picked);
            return;
        }

        if (e.key === "Escape") {
            e.preventDefault();
            setCompletionDismissed(true);
        }
    }

    return (
        <div
            ref={containerRef}
            style={{
                display: "flex",
                position: "relative",
                borderRadius: 10,
                border: isFocused ? "1px solid var(--pg-primary)" : "1px solid var(--pg-border)",
                background: disabled
                    ? "var(--pg-surface-overlay-disabled)"
                    : "var(--pg-surface-overlay)",
                boxShadow: isFocused
                    ? "0 0 0 3px rgba(var(--pg-primary-rgb), 0.25), inset 0 1px 0 rgba(255,255,255,0.02)"
                    : "inset 0 1px 0 rgba(255,255,255,0.03)",
                transition: "border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease",
                ...containerStyle,
            }}
        >
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    pointerEvents: "none",
                    overflow: "hidden",
                    borderRadius: 8,
                }}
            >
                <div
                    ref={overlayContentRef}
                    style={{
                        ...sharedTextStyle,
                        whiteSpace: "pre",
                        color: "transparent",
                        display: "block",
                        minWidth: "100%",
                        boxSizing: "border-box",
                    }}
                >
                    {parts.map((part, idx) => {
                        if (part.kind === "text") {
                            return <span key={idx}>{part.text}</span>;
                        }

                        const missing = part.status === "missing";
                        return (
                            <span
                                key={idx}
                                style={{
                                    background: missing
                                        ? "rgba(239, 68, 68, 0.22)"
                                        : "rgba(var(--pg-primary-rgb), 0.22)",
                                    borderBottom: missing
                                        ? "1px solid rgba(248, 113, 113, 0.84)"
                                        : "1px solid rgba(var(--pg-primary-rgb), 0.82)",
                                    borderRadius: 4,
                                }}
                            >
                                {part.text}
                            </span>
                        );
                    })}
                </div>
            </div>

            <input
                ref={inputRef}
                value={value}
                disabled={disabled}
                onChange={(e) => {
                    onChange(e.target.value);
                    setCaretIndex(e.target.selectionStart ?? e.target.value.length);
                    setCompletionDismissed(false);
                }}
                onFocus={() => {
                    setIsFocused(true);
                    syncCaretFromInput();
                }}
                onBlur={() => {
                    setIsFocused(false);
                    setHoverState(null);
                }}
                onClick={syncCaretFromInput}
                onSelect={syncCaretFromInput}
                onKeyUp={syncCaretFromInput}
                onKeyDown={onKeyDownInput}
                onMouseMove={onMouseMoveInput}
                onMouseLeave={() => setHoverState(null)}
                onScroll={(e) => {
                    syncScroll(e.currentTarget.scrollLeft);
                    setHoverState(null);
                }}
                placeholder={placeholder}
                className="variable-input-field"
                style={{
                    ...sharedTextStyle,
                    position: "relative",
                    zIndex: 1,
                    width: "100%",
                    border: "none",
                    outline: "none",
                    boxShadow: "none",
                    color: disabled ? "var(--pg-text-muted)" : "var(--pg-text)",
                    WebkitTextFillColor: disabled ? "var(--pg-text-muted)" : "var(--pg-text)",
                    caretColor: "var(--pg-primary)",
                    background: "transparent",
                    ...style,
                }}
            />

            {showCompletions && (
                <div
                    style={{
                        position: "absolute",
                        zIndex: 8,
                        top: "calc(100% + 6px)",
                        left: 0,
                        right: 0,
                        maxHeight: 220,
                        overflowY: "auto",
                        border: "1px solid var(--pg-border)",
                        borderRadius: 10,
                        background: "var(--pg-floating-bg)",
                        boxShadow: "0 16px 24px var(--pg-shadow-color)",
                    }}
                >
                    {completionItems.slice(0, 10).map((name, idx) => {
                        const active = idx === selectedCompletionIndex;
                        return (
                            <button
                                key={name}
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    applyCompletion(name);
                                }}
                                style={{
                                    width: "100%",
                                    textAlign: "left",
                                    border: "none",
                                    borderRadius: 0,
                                    padding: "8px 10px",
                                    background: active ? "rgba(var(--pg-primary-rgb), 0.2)" : "transparent",
                                    color: active ? "var(--pg-text)" : "var(--pg-text-dim)",
                                    boxShadow: "none",
                                    fontSize: 13,
                                }}
                            >
                                {"{{"}
                                {name}
                                {"}}"}
                            </button>
                        );
                    })}
                </div>
            )}

            {hoverState && (
                <div
                    style={{
                        position: "absolute",
                        zIndex: 9,
                        left: hoverState.left,
                        top: hoverState.top,
                        maxWidth: 380,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--pg-border)",
                        background: "var(--pg-floating-bg)",
                        color: "var(--pg-text-dim)",
                        fontSize: 12,
                        lineHeight: 1.45,
                        pointerEvents: "none",
                        boxShadow: "0 12px 20px var(--pg-shadow-color)",
                    }}
                >
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>
                        {"{{"}
                        {hoverState.match.name}
                        {"}}"}
                    </div>
                    <div>{variableValueLabel(hoverState.match.status, hoverState.resolvedValue)}</div>
                </div>
            )}
        </div>
    );
}
