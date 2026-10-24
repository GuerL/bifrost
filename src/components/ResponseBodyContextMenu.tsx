import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { copyTextToClipboard } from "../helpers/ClipboardRequestTransfer.ts";
import { notifyError } from "../helpers/Toast.tsx";
import { responseTextOffsetAtPoint } from "../helpers/responseJsonPath.ts";

type Props = {
    index: { pathAt: (offset: number) => string | null } | null;
    children: ReactNode;
};

export default function ResponseBodyContextMenu({ index, children }: Props) {
    const [menu, setMenu] = useState<{ x: number; y: number; path: string; root: HTMLElement; selection: string } | null>(null);
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
        const dismiss = () => setMenu(null);
        const keydown = (event: KeyboardEvent) => {
            if (event.key === "Escape" || event.key === "Tab") dismiss();
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const buttons = Array.from(menuRef.current?.querySelectorAll("button:not(:disabled)") ?? []) as HTMLButtonElement[];
                const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next = current < 0
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

    async function copy(text: string, jsonPath: boolean) {
        const selection = window.getSelection();
        const ranges = Array.from({ length: selection?.rangeCount ?? 0 }, (_, i) => selection!.getRangeAt(i).cloneRange());
        const focused = document.activeElement;
        setMenu(null);
        try {
            await copyTextToClipboard(text);
            setStatus(jsonPath ? "JSONPath copied" : "Copied");
            if (resetTimer.current) clearTimeout(resetTimer.current);
            resetTimer.current = setTimeout(() => setStatus(""), 1600);
        } catch {
            notifyError("Failed to copy");
        } finally {
            // The clipboard helper's legacy fallback selects a temporary textarea.
            selection?.removeAllRanges();
            ranges.forEach(range => selection?.addRange(range));
            if (focused instanceof HTMLElement && focused.isConnected && !menuRef.current?.contains(focused)) {
                focused.focus({ preventScroll: true });
            }
        }
    }

    return <div style={{ display: "contents" }} onMouseDown={event => {
        // Browsers may collapse the current selection before firing contextmenu.
        if (event.button !== 2 || !index) return;
        const root = (event.target as HTMLElement).closest<HTMLElement>('pre[aria-label="Response body"]');
        if (root && responseTextOffsetAtPoint(root, event.clientX, event.clientY) !== null) event.preventDefault();
    }} onContextMenu={event => {
        if (!index) return;
        const root = (event.target as HTMLElement).closest<HTMLElement>('pre[aria-label="Response body"]');
        if (!root) return;
        const offset = responseTextOffsetAtPoint(root, event.clientX, event.clientY);
        const path = offset === null ? null : index.pathAt(offset);
        if (path === null) return;
        event.preventDefault();
        const selection = window.getSelection();
        setMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 188)),
            y: Math.max(8, Math.min(event.clientY, window.innerHeight - 126)), path, root,
            selection: selection?.anchorNode && root.contains(selection.anchorNode) ? selection.toString() : "" });
    }}>
        {children}
        {status && <span role="status" className="pg-jsonpath-status">{status}</span>}
        {menu && createPortal(<div ref={menuRef} role="menu" aria-label="Response body actions"
            className="pg-jsonpath-menu" style={{ left: menu.x, top: menu.y }}
            onMouseDown={event => event.preventDefault()} onContextMenu={event => event.preventDefault()}>
            <button role="menuitem" onClick={() => void copy(menu.path, true)}>Copy JSONPath</button>
            <button role="menuitem" disabled={!menu.selection} onClick={() => void copy(menu.selection, false)}>Copy</button>
            <button role="menuitem" onClick={() => {
                const range = document.createRange();
                range.selectNodeContents(menu.root);
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
                setMenu(null);
            }}>Select All</button>
        </div>, document.body)}
    </div>;
}
