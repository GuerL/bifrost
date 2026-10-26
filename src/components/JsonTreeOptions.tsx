import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { jsonAdjustmentDepth, jsonDepthSelection, type JsonExpansionDepth, type JsonFoldState } from "../helpers/responseJsonFolding.ts";

type Props = {
    folds: JsonFoldState;
    maximumDepth: number;
    onDepthChange: (depth: JsonExpansionDepth) => void;
};

export default function JsonTreeOptions({ folds, maximumDepth, onDepthChange }: Props) {
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const id = useId();
    const selection = jsonDepthSelection(folds);
    const depth = jsonAdjustmentDepth(folds, maximumDepth);
    const label = selection === "all" ? "All" : selection === "custom" ? "Custom" : `Depth ${selection}`;

    function close(restoreFocus = false) {
        setPosition(null);
        if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
    }
    function open() {
        const rect = triggerRef.current!.getBoundingClientRect();
        setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 148)),
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 260)) });
    }

    useEffect(() => {
        if (!position) return;
        popupRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
        const outside = (event: PointerEvent) => {
            if (!popupRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) close();
        };
        // A pointer press can blur a button without focusing another element
        // (notably in WebKit). Only a confirmed outside focus destination dismisses.
        const focusOutside = (event: FocusEvent) => {
            if (!popupRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) close();
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation(); // Keep Escape from also closing response search.
            close(true);
        };
        const dismiss = () => close();
        document.addEventListener("pointerdown", outside);
        document.addEventListener("focusin", focusOutside);
        document.addEventListener("keydown", escape);
        window.addEventListener("resize", dismiss);
        window.addEventListener("blur", dismiss);
        return () => {
            document.removeEventListener("pointerdown", outside);
            document.removeEventListener("focusin", focusOutside);
            document.removeEventListener("keydown", escape);
            window.removeEventListener("resize", dismiss);
            window.removeEventListener("blur", dismiss);
        };
    }, [position]);

    return <>
        <button ref={triggerRef} type="button" className="pg-response-action pg-json-tree-trigger"
            aria-label="JSON tree options" aria-description={`Expansion: ${label}`} title={`JSON tree options: ${label}`}
            aria-haspopup="dialog" aria-expanded={!!position} aria-controls={position ? id : undefined}
            onClick={() => position ? close(true) : open()}
            onKeyDown={event => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (!position) open(); }
            }}>
            Tree · {label}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6.5 9.25 5.5 5.5 5.5-5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </button>
        {position && createPortal(<div ref={popupRef} id={id} role="dialog" aria-label="JSON tree options"
            className="pg-json-tree-popup" style={position}
            onKeyDown={event => {
                if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                    event.preventDefault(); event.stopPropagation();
                    const buttons = [...popupRef.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
                    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
                        : (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
                    buttons[next]?.focus({ preventScroll: true });
                }
            }}>
            <button type="button" className="pg-json-tree-action" onClick={() => onDepthChange(1)}>Collapse All</button>
            <button type="button" className="pg-json-tree-action" onClick={() => onDepthChange("all")}>Expand All</button>
            <div className="pg-json-depth-control">
                <span>Expand to depth</span>
                <button type="button" aria-label="Decrease JSON depth" title="Decrease depth" disabled={depth <= 1}
                    onClick={() => onDepthChange(depth - 1)}>−</button>
                <output aria-label="JSON expansion depth" aria-description={`Minimum 1, maximum ${maximumDepth}`} aria-live="polite" title={`Maximum depth: ${maximumDepth}`}>{depth}</output>
                <button type="button" aria-label="Increase JSON depth" title="Increase depth" disabled={depth >= maximumDepth}
                    onClick={() => onDepthChange(depth + 1)}>+</button>
            </div>
        </div>, document.body)}
    </>;
}
