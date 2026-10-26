// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpResponseDto } from "../types.ts";
import ResponsePanel from "./ResponsePanel.tsx";

// Keep the depth control accessible in jsdom without testing Radix's pointer handling.
vi.mock("./AppSelect.tsx", () => ({ default: ({ value, options, onValueChange, ariaLabel }: {
    value: string; options: { value: string; label: string; disabled?: boolean }[];
    onValueChange: (value: string) => void; ariaLabel: string;
}) => <select aria-label={ariaLabel} value={value} onChange={event => onValueChange(event.target.value)}>
    {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
</select> }));

let host: HTMLDivElement;
let root: Root;
let response: HttpResponseDto;
const scroll = vi.fn();
function render(requestId = "a") {
    act(() => root.render(<ResponsePanel requestId={requestId} response={response} statusText="OK"
        scriptReport={null} runtimeVariables={{}} onClearRuntimeVariables={() => {}}
        activeTab="body" onTabChange={() => {}} />));
}
function click(label: string) {
    const button = host.querySelector(`[aria-label="${label}"]`) ?? [...host.querySelectorAll("button")].find(button => button.textContent === label);
    expect(button, label).toBeTruthy();
    act(() => (button as HTMLButtonElement).click());
}
function query(value: string) {
    const input = host.querySelector("input")!;
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
function open(value: string) {
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true })));
    query(value);
}
function active() { return host.querySelector('[data-search-active="true"]'); }
function collapsed(path: string) { return !!host.querySelector(`[aria-label="Expand ${path}"]`); }
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    HTMLElement.prototype.scrollIntoView = scroll;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { callback(0); return 1; });
    response = { body_text: JSON.stringify({ branch: { needleKey: ["Needle", 42, true, null] }, other: { untouched: 1 } }), status: 200, headers: [], duration_ms: 1 };
    render();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); scroll.mockClear(); });

describe("structured response search", () => {
    it("finds hidden keys and values, reveals only ancestors, highlights exact text and wraps navigation", () => {
        click("Collapse All"); open("needle");
        expect(collapsed("$.branch")).toBe(true);
        expect(host.textContent).toContain("0/2");
        click("Next match");
        expect(active()?.textContent).toBe("needle");
        expect(collapsed("$.branch")).toBe(false);
        expect(collapsed("$.branch.needleKey")).toBe(true);
        expect(collapsed("$.other")).toBe(true);
        click("Next match"); expect(active()?.textContent).toBe("Needle");
        expect(collapsed("$.branch.needleKey")).toBe(false);
        expect(scroll).toHaveBeenCalled();
        click("Next match"); expect(active()?.textContent).toBe("needle");
        click("Previous match"); expect(active()?.textContent).toBe("Needle");
        query("");
        expect(host.querySelector("[data-search-match]")).toBeNull();
        expect(collapsed("$.branch")).toBe(true);
    });
    it("preserves manual changes and depth presets when clearing search", () => {
        click("Collapse All"); open("Needle"); click("Next match");
        click("Expand $.other");
        query("");
        expect(collapsed("$.branch")).toBe(true);
        expect(collapsed("$.other")).toBe(false);
        query("Needle"); click("Next match");
        click("Collapse $.branch");
        expect(collapsed("$.branch")).toBe(true);
        query(""); expect(collapsed("$.branch")).toBe(true);
        query("Needle"); click("Next match"); click("Expand All"); query("");
        expect(collapsed("$.branch")).toBe(false);
    });
    it("keeps depth presets unchanged by search and applies depth changes during search", () => {
        const depth = host.querySelector("select")!;
        const setDepth = (value: string) => act(() => {
            depth.value = value; depth.dispatchEvent(new Event("change", { bubbles: true }));
        });
        setDepth("2"); open("Needle"); click("Next match"); click("Next match");
        expect(depth.value).toBe("2");
        expect(collapsed("$.branch.needleKey")).toBe(false);
        query(""); expect(collapsed("$.branch.needleKey")).toBe(true);
        query("Needle"); click("Next match"); click("Next match");
        setDepth("1"); expect(collapsed("$.branch")).toBe(true);
        query(""); expect(depth.value).toBe("1");
        expect(collapsed("$.branch")).toBe(true);
    });
    it("maps decoded escaped text back to JSON source and preserves keyboard navigation", () => {
        response = { ...response, body_text: JSON.stringify({ 'line"key': 'line"value' }) }; render();
        open('line"v');
        act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })));
        expect(active()?.textContent).toBe('line\\"v');
        act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true })));
        expect(active()?.textContent).toBe('line\\"v');
        act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
        expect(host.querySelector("[data-search-match]")).toBeNull();
    });
    it("supports case toggling, primitive values and excludes punctuation and counts", () => {
        open("Needle"); expect(host.textContent).toContain("0/2");
        click("Toggle match case"); expect(host.textContent).toContain("0/1");
        click("Next match"); expect(active()?.textContent).toBe("Needle");
        for (const value of ["42", "true", "null"]) {
            query(value); click("Next match"); expect(active()?.textContent).toBe(value);
        }
        for (const value of ["{", ":", "items", "keys"]) {
            query(value); expect(host.textContent).toContain("0/0");
        }
    });
    it("resets automatic expansion on request switches and new responses with identical text", () => {
        click("Collapse All"); open("Needle"); click("Next match");
        render("b"); expect(active()).toBeNull();
        click("Collapse All"); expect(collapsed("$.branch")).toBe(true);
        click("Next match"); expect(active()).toBeTruthy();
        response = { ...response }; render("b");
        expect(active()).toBeNull(); expect(collapsed("$.branch")).toBe(false);
    });
    it.each(['["hit", {"hit": false}]', '"hit"', '42', 'null'])("searches root arrays and primitives: %s", body => {
        response = { ...response, body_text: body, headers: [{ key: "Content-Type", value: "application/json" }] }; render();
        const value = body.includes("hit") ? "hit" : body;
        open(value); click("Next match"); expect(active()?.textContent).toBe(value);
    });
    it.each(["plain hit text", "<xml>hit</xml>", "<html>hit</html>", '{invalid hit'])("keeps non-JSON search navigation: %s", body => {
        response = { ...response, body_text: body }; render(); open("hit");
        expect(host.textContent).toContain("0/1"); click("Next match");
        expect(host.textContent).toContain("1/1"); expect(scroll).toHaveBeenCalled();
    });
});
