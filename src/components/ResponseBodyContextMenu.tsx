import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { copyTextToClipboard } from "../helpers/ClipboardRequestTransfer.ts";
import { notifyError } from "../helpers/Toast.tsx";
import { bifrostExpressionFromSegments, jsonPathFromSegments, responseTextOffsetAtPoint, type ResponseJsonIndex } from "../helpers/responseJsonPath.ts";

type Props = {
    index: ResponseJsonIndex | null;
    children: ReactNode;
};

type MenuTarget = {
    x: number;
    y: number;
    path: string;
    expression: string;
    root: HTMLElement;
    origin: HTMLElement;
    offset: number;
    container: boolean;
    selection: string;
    ranges: Range[];
};

export default function ResponseBodyContextMenu({ index, children }: Props) {
    const [menu, setMenu] = useState<MenuTarget | null>(null);
    const [status, setStatus] = useState("");
    const menuRef = useRef<HTMLDivElement>(null);
    const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        setMenu(null);
        setStatus("");
    }, [index]);
    useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);
    useEffect(() => {
        if (!menu) return;
        menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
        restoreSelection(menu.ranges);
        const dismiss = () => setMenu(null);
        const keydown = (event: KeyboardEvent) => {
            if (event.key === "Escape" || event.key === "Tab") {
                if (event.key === "Escape") event.preventDefault();
                closeMenu();
            }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const buttons = Array.from(menuRef.current?.querySelectorAll("button:not(:disabled)") ?? []) as HTMLButtonElement[];
                const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : current < 0
                    ? event.key === "ArrowDown" ? 0 : buttons.length - 1
                    : (current + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
                buttons[next]?.focus({ preventScroll: true });
            }
        };
        const outside = (event: PointerEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) dismiss();
        };
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", keydown);
        document.addEventListener("scroll", dismiss, true);
        window.addEventListener("resize", dismiss);
        window.addEventListener("blur", dismiss);
        return () => {
            document.removeEventListener("pointerdown", outside);
            document.removeEventListener("keydown", keydown);
            document.removeEventListener("scroll", dismiss, true);
            window.removeEventListener("resize", dismiss);
            window.removeEventListener("blur", dismiss);
        };
    }, [menu]);

    function restoreSelection(ranges: Range[]) {
        const selection = window.getSelection();
        selection?.removeAllRanges();
        ranges.forEach(range => selection?.addRange(range));
    }

    function closeMenu(preserveSelection = true) {
        setMenu(null);
        if (menu?.origin.isConnected) menu.origin.focus({ preventScroll: true });
        if (preserveSelection && menu) restoreSelection(menu.ranges);
    }

    function openMenu(root: HTMLElement, origin: HTMLElement, offset: number, x: number, y: number) {
        if (!index) return false;
        const segments = index.segmentsAt(offset);
        if (!segments) return false;
        // Container membership does not depend on which descendants are currently visible.
        const container = index.isContainerAt(offset);
        const selection = window.getSelection();
        setMenu({ x: Math.max(8, Math.min(x, window.innerWidth - 228)),
            y: Math.max(8, Math.min(y, window.innerHeight - 190)),
            path: jsonPathFromSegments(segments), expression: bifrostExpressionFromSegments(segments), root, origin, offset, container,
            ranges: Array.from({ length: selection?.rangeCount ?? 0 }, (_, i) => selection!.getRangeAt(i).cloneRange()),
            selection: selection?.anchorNode && root.contains(selection.anchorNode) ? selection.toString() : "" });
        return true;
    }

    async function copy(text: string, confirmation = "Copied") {
        const ranges = menu?.ranges ?? [];
        closeMenu();
        try {
            await copyTextToClipboard(text);
            setStatus(confirmation);
            if (resetTimer.current) clearTimeout(resetTimer.current);
            resetTimer.current = setTimeout(() => setStatus(""), 1600);
        } catch {
            notifyError("Failed to copy");
        } finally {
            // The clipboard helper's legacy fallback selects a temporary textarea.
            // Restore focus as well, unless the user moved on while the copy was pending.
            if (menu?.origin.isConnected && (document.activeElement === document.body || document.activeElement === menu.origin)) {
                menu.origin.focus({ preventScroll: true });
                restoreSelection(ranges);
            }
        }
    }

    return <div style={{ display: "contents" }} onKeyDown={event => {
        if (!index || event.defaultPrevented) return;
        const target = event.target as HTMLElement;
        const root = target.closest<HTMLElement>('pre[aria-label="Response body"]');
        if (!root) return;
        const row = target.closest<HTMLElement>("[data-json-node-offset]");
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            const offset = Number(row?.dataset.jsonNodeOffset ?? target.closest<HTMLElement>("[data-json-offset]")?.dataset.jsonOffset ?? 0);
            const rect = (row ?? target).getBoundingClientRect();
            if (openMenu(root, target, offset, rect.left, rect.bottom)) {
                event.preventDefault();
                event.stopPropagation();
            }
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-json-node-offset]"));
            if (!rows.length) return;
            const current = row ? rows.indexOf(row) : -1;
            const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
                : current < 0 ? event.key === "ArrowDown" ? 0 : rows.length - 1
                : Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
            event.preventDefault();
            rows[next].focus();
        }
    }} onMouseDown={event => {
        // Browsers may collapse the current selection before firing contextmenu.
        if (event.button !== 2 || !index) return;
        const root = (event.target as HTMLElement).closest<HTMLElement>('pre[aria-label="Response body"]');
        if (root && responseTextOffsetAtPoint(root, event.clientX, event.clientY) !== null) event.preventDefault();
    }} onContextMenu={event => {
        if (!index) return;
        const root = (event.target as HTMLElement).closest<HTMLElement>('pre[aria-label="Response body"]');
        if (!root) return;
        const offset = responseTextOffsetAtPoint(root, event.clientX, event.clientY);
        const target = event.target as HTMLElement;
        const origin = target.closest<HTMLElement>("button, [data-json-node-offset]") ?? root;
        if (offset !== null && openMenu(root, origin, offset, event.clientX, event.clientY)) {
            event.preventDefault();
            event.stopPropagation();
        }
    }}>
        {children}
        {status && <span role="status" className="pg-jsonpath-status">{status}</span>}
        {menu && createPortal(<div ref={menuRef} role="menu" aria-label={`Response body actions for ${menu.path}`}
            className="pg-jsonpath-menu" style={{ left: menu.x, top: menu.y, width: "max-content" }}
            onMouseDown={event => event.preventDefault()} onContextMenu={event => event.preventDefault()}>
            <button type="button" role="menuitem" onClick={() => {
                const value = index?.copyAt(menu.offset);
                if (value) void copy(value.text, value.container ? "JSON copied" : "Value copied");
            }}>{menu.container ? "Copy JSON" : "Copy Value"}</button>
            <button type="button" role="menuitem" onClick={() => void copy(menu.path, "JSONPath copied")}>Copy JSONPath</button>
            <button type="button" role="menuitem" onClick={() => void copy(menu.expression, "Bifrost expression copied")}>Copy as Bifrost Expression</button>
            <button type="button" role="menuitem" disabled={!menu.selection} onClick={() => void copy(menu.selection)}>Copy</button>
            <button type="button" role="menuitem" onClick={() => {
                closeMenu(false);
                const range = document.createRange();
                range.selectNodeContents(menu.root);
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
            }}>Select All</button>
        </div>, document.body)}
    </div>;
}
