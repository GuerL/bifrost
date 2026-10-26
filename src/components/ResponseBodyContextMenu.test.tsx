// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResponsePanel from "./ResponsePanel.tsx";
import { copyTextToClipboard } from "../helpers/ClipboardRequestTransfer.ts";
import { notifyError } from "../helpers/Toast.tsx";
import { responseTextOffsetAtPoint } from "../helpers/responseJsonPath.ts";

vi.mock("../helpers/ClipboardRequestTransfer.ts", () => ({ copyTextToClipboard: vi.fn() }));
vi.mock("../helpers/Toast.tsx", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
// jsdom has no text geometry. Exercise the real offset index with controlled hit testing.
vi.mock("../helpers/responseJsonPath.ts", async importOriginal => ({
    ...await importOriginal<typeof import("../helpers/responseJsonPath.ts")>(),
    responseTextOffsetAtPoint: vi.fn(),
}));

let host: HTMLDivElement;
let root: Root;
let formatted: string;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.mocked(copyTextToClipboard).mockResolvedValue(undefined);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});

async function render(value: unknown) {
    formatted = JSON.stringify(value, null, 2);
    await act(async () => root.render(<ResponsePanel response={{ body_text: JSON.stringify(value), status: 200, headers: [{ key: "content-type", value: "application/json" }], duration_ms: 1 }}
        statusText="OK" scriptReport={null} runtimeVariables={{}} onClearRuntimeVariables={() => {}}
        activeTab="body" onTabChange={() => {}} requestId="request" />));
}
function button(label: string) {
    const found = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find(element => element.textContent === label || element.getAttribute("aria-label") === label);
    expect(found, label).toBeDefined();
    return found!;
}
async function click(element: HTMLElement) {
    await act(async () => element.click());
}
async function key(element: HTMLElement, value: string, shiftKey = false) {
    await act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true })));
}
async function context(token: string, target?: HTMLElement) {
    const offset = formatted.indexOf(token);
    expect(offset).toBeGreaterThanOrEqual(0);
    vi.mocked(responseTextOffsetAtPoint).mockReturnValue(offset);
    const element = target ?? host.querySelector<HTMLElement>(`[data-json-offset="${offset}"]`) ?? host.querySelector("pre")!;
    await act(async () => element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 })));
}
function menu() { return document.querySelector<HTMLElement>('[role="menu"]'); }

describe("response JSON row layout", () => {
    const object = {
        name: "Quentin",
        address: { city: "Brussels", geo: { lat: 1, lng: 2 } },
        company: { name: "Bifrost", roles: ["dev", "admin"] },
        active: true, empty: {}, nil: null,
    };
    it.each(["dark", "light"].flatMap(theme => [
        { theme, kind: "object", value: object },
        { theme, kind: "array", value: [object, [1, { nested: [{ id: 1 }] }], [], false] },
    ]))("keeps shared row structure and inline control sizing through repeated folds: $theme $kind", async ({ theme, value }) => {
        const style = document.createElement("style");
        // Vitest stubs CSS imports; load the actual cascade without adding Node types to the app.
        const { readFileSync } = await vi.importActual<{ readFileSync: (path: URL, encoding: "utf8") => string }>("node:fs");
        style.textContent = ["../App.css", "../design/qvb-tokens.css", "../design/bifrost-qvb.css"]
            .map(path => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
        document.head.append(style);
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.visualIdentity = "qvb";
        try {
            await render(value);
            const snapshot = (row: HTMLElement) => ({
                columns: getComputedStyle(row).gridTemplateColumns,
                children: Array.from(row.children, child => child.className),
                indent: row.querySelector(".pg-json-indent")!.textContent,
                slotHeight: getComputedStyle(row.querySelector(".pg-json-disclosure-slot")!).height,
            });
            const baseline = new Map(Array.from(host.querySelectorAll<HTMLElement>(".pg-json-row"), row => [row.dataset.jsonNodeOffset, snapshot(row)]));
            const paths = Array.from(host.querySelectorAll<HTMLButtonElement>(".pg-json-disclosure"), control => control.getAttribute("aria-label")!.slice("Collapse ".length));
            const checkRows = () => {
                for (const row of host.querySelectorAll<HTMLElement>(".pg-json-row")) {
                    expect(snapshot(row)).toEqual(baseline.get(row.dataset.jsonNodeOffset));
                    expect(getComputedStyle(row).display).toBe("grid");
                    expect(Array.from(row.children, child => child.className)).toEqual([
                        "pg-json-indent", "pg-json-disclosure-slot", "pg-json-line-content",
                    ]);
                    // The gutter follows the text line, including on primitive/empty rows.
                    expect(getComputedStyle(row.querySelector(".pg-json-disclosure-slot")!).height).toBe("1lh");
                }
                for (const control of host.querySelectorAll<HTMLButtonElement>(".pg-json-disclosure, .pg-json-fold-preview")) {
                    // Neither control may inherit the global 30px form-control minimum.
                    expect(parseFloat(getComputedStyle(control).minHeight)).toBe(0);
                    if (control.classList.contains("pg-json-disclosure")) {
                        expect(getComputedStyle(control).width).toBe("100%");
                        expect(getComputedStyle(control).height).toBe("100%");
                        expect(control.parentElement!.className).toBe("pg-json-disclosure-slot");
                    }
                }
            };
            checkRows();
            for (let cycle = 0; cycle < 2; cycle++) {
                // Folding descendants before parents also exercises retained nested state.
                for (const path of [...paths].reverse()) { await click(button(`Collapse ${path}`)); checkRows(); }
                for (const path of paths) { await click(button(`Expand ${path}`)); checkRows(); }
                await click(button("Collapse All")); checkRows();
                await click(button("Expand All")); checkRows();
            }
        } finally {
            style.remove();
            delete document.documentElement.dataset.theme;
            delete document.documentElement.dataset.visualIdentity;
        }
    });
});

describe("response JSON contextual copy actions", () => {
    it.each(["Quentin", "", 'é🦄\n"\\', 42, -2.5, true, false, null])("copies primitive %j without keys and restores focus", async value => {
        await render({ selected: value, sibling: 1 });
        await context('"selected"');
        expect(menu()?.getAttribute("aria-label")).toBe("Response body actions for $.selected");
        expect(document.activeElement).toBe(button("Copy Value"));
        expect(Array.from(menu()!.querySelectorAll("button"), item => item.textContent)).not.toContain("Copy JSON");
        await click(button("Copy Value"));
        expect(copyTextToClipboard).toHaveBeenCalledWith(typeof value === "string" ? value : JSON.stringify(value));
        expect(menu()).toBeNull();
        expect(document.activeElement?.className).toBe("pg-json-row");
        expect(document.querySelector('[role="status"]')?.textContent).toBe("Value copied");
        expect(host.querySelector('[aria-label="Collapse $"]')).not.toBeNull();
    });

    it.each([{}, [], { nested: [{ id: 1 }, null, [true]] }, ["a", { child: [1] }]].map(value => ({ value })))("copies complete container JSON: $value", async ({ value }) => {
        await render({ selected: value });
        await context('"selected"');
        expect(button("Copy JSON")).toBe(document.activeElement);
        expect(menu()?.textContent).not.toContain("Copy Value");
        await click(button("Copy JSON"));
        expect(copyTextToClipboard).toHaveBeenCalledWith(JSON.stringify(value, null, 2));
    });

    it("copies a full collapsed subtree without changing folds, then still expands its preview", async () => {
        const subtree = { nested: [{ id: 42 }, { id: 7 }], empty: [] };
        await render({ selected: subtree, after: true });
        await click(button("Collapse All"));
        const preview = host.querySelector<HTMLButtonElement>(".pg-json-fold-preview")!;
        expect(preview.textContent).toBe("{…}");
        // The preview is anchored at the actual value, not the abbreviated visible text.
        vi.mocked(responseTextOffsetAtPoint).mockReturnValue(Number(preview.dataset.jsonOffset));
        await act(async () => preview.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
        await click(button("Copy JSON"));
        expect(copyTextToClipboard).toHaveBeenCalledWith(JSON.stringify(subtree, null, 2));
        expect(preview.isConnected).toBe(true);
        expect(button("Expand $.selected").getAttribute("aria-expanded")).toBe("false");
        await click(preview);
        expect(button("Collapse $.selected").getAttribute("aria-expanded")).toBe("true");
        await click(button("Expand All"));
        expect(host.querySelector(".pg-json-fold-preview")).toBeNull();
        expect(host.textContent).toContain("42");
    });

    it("copies a manually collapsed root through keyboard actions without expanding it", async () => {
        const value = [{ nested: [1, 2] }, { empty: {} }];
        await render(value);
        await click(button("Collapse $"));
        const preview = host.querySelector<HTMLButtonElement>(".pg-json-fold-preview")!;
        preview.focus();
        await key(preview, "F10", true);
        await click(button("Copy JSON"));
        expect(copyTextToClipboard).toHaveBeenCalledWith(JSON.stringify(value, null, 2));
        expect(document.activeElement).toBe(preview);
        expect(preview.isConnected).toBe(true);
        expect(button("Expand $").getAttribute("aria-expanded")).toBe("false");
        await click(preview);
        expect(button("Collapse $").getAttribute("aria-expanded")).toBe("true");
    });

    it.each([{}, [], { nested: [1, 2] }, [1, {}], "root", false, null].map(value => ({ value })))("copies root JSON/value: $value", async ({ value }) => {
        await render(value);
        const pre = host.querySelector("pre")!;
        pre.focus();
        await key(pre, "F10", true);
        await click(button(value !== null && typeof value === "object" ? "Copy JSON" : "Copy Value"));
        expect(copyTextToClipboard).toHaveBeenCalledWith(typeof value === "string" ? value : JSON.stringify(value, null, 2));
        expect(document.activeElement).toBe(pre);
    });

    it("targets nested array elements and special keys consistently with JSONPath and Bifrost expressions", async () => {
        await render({ 'a.b ["x"]': [{ id: 1 }, { id: 2 }] });
        await context('2');
        expect(menu()?.getAttribute("aria-label")).toBe('Response body actions for $["a.b [\\"x\\"]"][1].id');
        await click(button("Copy JSONPath"));
        expect(copyTextToClipboard).toHaveBeenLastCalledWith('$["a.b [\\"x\\"]"][1].id');
        await context('2');
        await click(button("Copy as Bifrost Expression"));
        expect(copyTextToClipboard).toHaveBeenLastCalledWith('bf.response.json()["a.b [\\"x\\"]"][1].id');
        await context('2');
        await click(button("Copy Value"));
        expect(copyTextToClipboard).toHaveBeenLastCalledWith("2");
    });

    it("supports line navigation, keyboard menu access, arrow navigation and Escape focus restoration", async () => {
        await render({ first: 1, second: false });
        const pre = host.querySelector("pre")!;
        pre.focus();
        await key(pre, "ArrowDown");
        await key(document.activeElement as HTMLElement, "ArrowDown");
        const origin = document.activeElement as HTMLElement;
        expect(origin.textContent).toContain('"first"');
        await key(origin, "F10", true);
        expect(document.activeElement).toBe(button("Copy Value"));
        await key(button("Copy Value"), "ArrowDown");
        expect(document.activeElement).toBe(button("Copy JSONPath"));
        await key(button("Copy JSONPath"), "End");
        expect(document.activeElement).toBe(button("Select All"));
        await key(button("Select All"), "Escape");
        expect(menu()).toBeNull();
        expect(document.activeElement).toBe(origin);
        await key(origin, "ArrowDown");
        await key(document.activeElement as HTMLElement, "ContextMenu");
        expect(menu()?.getAttribute("aria-label")).toBe("Response body actions for $.second");
        await key(button("Copy Value"), "Tab");
        expect(menu()).toBeNull();
    });

    it("preserves selected text when copying and retains the selection Copy action", async () => {
        await render({ name: "selected text" });
        const span = Array.from(host.querySelectorAll("[data-json-offset]")).find(element => element.textContent === '"selected text"')!;
        const range = document.createRange();
        range.selectNodeContents(span);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        await context('"name"');
        expect(button("Copy").disabled).toBe(false);
        await click(button("Copy Value"));
        expect(window.getSelection()!.toString()).toBe('"selected text"');
        await context('"name"');
        await click(button("Copy"));
        expect(copyTextToClipboard).toHaveBeenLastCalledWith('"selected text"');
    });

    it("handles clipboard failure without changing fold state", async () => {
        await render({ selected: [1, 2] });
        await click(button("Collapse $.selected"));
        vi.mocked(copyTextToClipboard).mockRejectedValueOnce(new Error("denied"));
        await context('"selected"');
        await click(button("Copy JSON"));
        expect(notifyError).toHaveBeenCalledWith("Failed to copy");
        expect(menu()).toBeNull();
        expect(button("Expand $.selected").getAttribute("aria-expanded")).toBe("false");
    });

    it("restores focus after the clipboard fallback temporarily focuses a textarea", async () => {
        await render({ value: "text" });
        vi.mocked(copyTextToClipboard).mockImplementationOnce(async () => {
            const textarea = document.createElement("textarea");
            document.body.append(textarea);
            textarea.focus();
            textarea.remove();
        });
        await context('"value"');
        await click(button("Copy Value"));
        expect(document.activeElement?.className).toBe("pg-json-row");
    });

    it("ignores blank-space hits and dismisses on outside pointer interactions", async () => {
        await render({ value: 1 });
        vi.mocked(responseTextOffsetAtPoint).mockReturnValue(null);
        await act(async () => host.querySelector("pre")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
        expect(menu()).toBeNull();
        await context('"value"');
        await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
        expect(menu()).toBeNull();
    });
});
