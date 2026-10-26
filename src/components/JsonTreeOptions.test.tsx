// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JsonTreeOptions from "./JsonTreeOptions.tsx";
import { applyJsonDepth, type JsonExpansionDepth } from "../helpers/responseJsonFolding.ts";

let host: HTMLDivElement;
let root: Root;
const changed = vi.fn();
function Harness() {
    const [folds, setFolds] = useState(() => applyJsonDepth(2));
    return <>
        <JsonTreeOptions folds={folds} maximumDepth={4} onDepthChange={depth => {
            changed(depth);
            setFolds(previous => applyJsonDepth(depth, previous));
        }} />
        <button type="button" aria-label="Outside">Outside</button>
    </>;
}
function button(label: string) {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find(element => element.getAttribute("aria-label") === label || element.textContent === label);
    expect(found, label).toBeTruthy();
    return found!;
}
function popup() { return document.querySelector('[role="dialog"]'); }
function dispatch(target: HTMLElement, type: string) {
    act(() => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })));
}
function key(target: HTMLElement, value: string, type = "keydown") {
    act(() => target.dispatchEvent(new KeyboardEvent(type, { key: value, bubbles: true, cancelable: true })));
}
function open() { act(() => button("JSON tree options").click()); }
// jsdom .click() omits pointer events and their native focus changes. Model both
// focus-on-click and WebKit's non-focusing mouse buttons explicitly.
function pointerPress(target: HTMLButtonElement, focusOnClick: boolean) {
    dispatch(target, "pointerdown");
    dispatch(target, "mousedown");
    act(() => {
        if (focusOnClick && !target.disabled) target.focus();
        else (document.activeElement as HTMLElement)?.blur();
    });
}
function pointerRelease(target: HTMLButtonElement) {
    dispatch(target, "pointerup");
    dispatch(target, "mouseup");
    act(() => target.click());
}
function pointerClick(target: HTMLButtonElement, focusOnClick = true) {
    pointerPress(target, focusOnClick);
    pointerRelease(target);
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    changed.mockClear();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("JSON tree popover interaction lifecycle", () => {
    it.each<[string, JsonExpansionDepth]>([
        ["Collapse All", 1], ["Expand All", "all"],
        ["Decrease JSON depth", 1], ["Increase JSON depth", 3],
    ])("executes %s when mousedown blurs without a focus destination", (label, expected) => {
        open();
        const content = popup()!;
        const action = button(label);
        const blur = vi.fn();
        document.activeElement!.addEventListener("focusout", blur, { once: true });
        dispatch(action, "pointerdown");
        expect(popup()).toBe(content); // The outside-pointer guard correctly accepts portal content.
        dispatch(action, "mousedown");
        act(() => (document.activeElement as HTMLElement).blur());
        expect(blur).toHaveBeenCalledOnce();
        expect((blur.mock.calls[0][0] as FocusEvent).relatedTarget).toBeNull();
        expect(content.isConnected).toBe(true); // Must survive until the subsequent click.
        pointerRelease(action);
        expect(changed).toHaveBeenCalledExactlyOnceWith(expected);
        expect(popup()).toBe(content);
    });

    it.each([true, false])("keeps the same portal mounted through repeated pointer adjustments (focus on click: %s)", focusOnClick => {
        open();
        const content = popup();
        const increase = button("Increase JSON depth");
        const decrease = button("Decrease JSON depth");
        for (const expected of [3, 4]) {
            pointerClick(increase, focusOnClick);
            expect(popup()).toBe(content);
            expect(document.querySelector("output")?.textContent).toBe(String(expected));
            expect(button("JSON tree options").textContent).toBe(`Tree · Depth ${expected}`);
            if (focusOnClick) expect(document.activeElement).toBe(increase);
        }
        expect(increase.disabled).toBe(true);
        changed.mockClear();
        pointerClick(increase, focusOnClick);
        expect(changed).not.toHaveBeenCalled();
        for (const expected of [3, 2, 1]) {
            pointerClick(decrease, focusOnClick);
            expect(popup()).toBe(content);
            expect(document.querySelector("output")?.textContent).toBe(String(expected));
            if (focusOnClick) expect(document.activeElement).toBe(decrease);
        }
        expect(decrease.disabled).toBe(true);
        changed.mockClear();
        pointerClick(decrease, focusOnClick);
        expect(changed).not.toHaveBeenCalled();
        expect(popup()).toBe(content);
    });

    it("toggles the trigger across a non-focusing pointer sequence", () => {
        pointerClick(button("JSON tree options"), false);
        expect(popup()).toBeTruthy();
        expect(button("JSON tree options").getAttribute("aria-expanded")).toBe("true");
        pointerClick(button("JSON tree options"), false);
        expect(popup()).toBeNull();
        expect(button("JSON tree options").getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(button("JSON tree options"));
    });

    it("dismisses on an outside pointer press before click without taking outside focus", () => {
        open();
        const outside = button("Outside");
        pointerPress(outside, true);
        expect(popup()).toBeNull();
        expect(document.activeElement).toBe(outside);
        pointerRelease(outside);
        expect(changed).not.toHaveBeenCalled();
    });

    it("handles Escape after an internal pointer blur and restores trigger focus", () => {
        open();
        pointerClick(button("Increase JSON depth"), false);
        expect(document.activeElement).toBe(document.body);
        const downstreamEscape = vi.fn();
        window.addEventListener("keydown", downstreamEscape);
        try {
            key(document.body, "Escape");
            expect(popup()).toBeNull();
            expect(document.activeElement).toBe(button("JSON tree options"));
            expect(downstreamEscape).not.toHaveBeenCalled();
            key(button("JSON tree options"), "Escape");
            expect(downstreamEscape).toHaveBeenCalledOnce(); // Listener is removed on dismissal.
        } finally { window.removeEventListener("keydown", downstreamEscape); }
    });

    it.each(["Enter", " "])("keeps native button activation available with %j and preserves internal focus", activationKey => {
        const trigger = button("JSON tree options");
        act(() => trigger.focus());
        // jsdom does not synthesize a native click from key events; explicitly
        // dispatch the button's default activation between keydown/keyup.
        function activate(target: HTMLButtonElement) {
            let allowed = false;
            act(() => {
                allowed = target.dispatchEvent(new KeyboardEvent("keydown", { key: activationKey, bubbles: true, cancelable: true }));
                if (allowed && activationKey === "Enter") target.click();
                target.dispatchEvent(new KeyboardEvent("keyup", { key: activationKey, bubbles: true, cancelable: true }));
                if (allowed && activationKey === " ") target.click();
            });
            expect(allowed).toBe(true);
        }
        activate(trigger);
        expect(popup()).toBeTruthy();
        for (const [label, expected] of [
            ["Collapse All", 1], ["Increase JSON depth", 2],
            ["Decrease JSON depth", 1], ["Expand All", "all"],
        ] as const) {
            const action = button(label);
            act(() => action.focus());
            expect(popup()).toBeTruthy();
            activate(action);
            expect(changed).toHaveBeenLastCalledWith(expected);
            expect(document.activeElement).toBe(action);
            expect(popup()).toBeTruthy();
        }
        const disabled = button("Increase JSON depth");
        expect(disabled.disabled).toBe(true);
        changed.mockClear();
        activate(disabled);
        expect(changed).not.toHaveBeenCalled();
        key(button("Expand All"), "Escape");
        expect(document.activeElement).toBe(trigger);
    });

});
