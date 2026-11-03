// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import VariableInput from "./VariableInput";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    host.style.overflow = "auto";
    host.style.transform = "translateY(0)";
    document.body.append(host);
    root = createRoot(host);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        measureText: (text: string) => ({ width: text.length * 8 }),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return { left: 0, top: 0, width: this.role === "tooltip" ? 200 : 300,
            height: this.role === "tooltip" ? 60 : 30 } as DOMRect;
    });
    act(() => root.render(<VariableInput value="{{commonPostId}}" onChange={() => {}}
        resolveVariableValue={() => "1"} />));
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
});
function hover(x = 30, y = 10) {
    act(() => host.querySelector("input")!.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true, clientX: x, clientY: y,
    })));
    return document.querySelector<HTMLElement>('[role="tooltip"]')!;
}
it("escapes transformed rows and clipping ancestors without intercepting input", () => {
    const tooltip = hover();
    expect(tooltip.parentElement).toBe(document.body);
    expect(tooltip.textContent).toBe("{{commonPostId}}Resolved value: 1");
    expect(tooltip.style.position).toBe("fixed");
    expect(tooltip.style.pointerEvents).toBe("none");
    expect(tooltip.style.left).toBe("40px");
    expect(tooltip.style.top).toBe("28px");
});
it("clamps horizontally and flips above the pointer at the viewport bottom", () => {
    // Keep the pointer over the token while simulating an input at the right edge.
    host.querySelector("input")!.getBoundingClientRect = () => ({ left: window.innerWidth - 100 } as DOMRect);
    const tooltip = hover(window.innerWidth - 70, window.innerHeight - 20);
    expect(tooltip.style.left).toBe(`${window.innerWidth - 208}px`);
    expect(tooltip.style.top).toBe(`${window.innerHeight - 90}px`);
});
it("dismisses on ancestor scroll and positions freshly on re-hover", () => {
    hover();
    act(() => host.dispatchEvent(new Event("scroll")));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(hover(40, 20).style.top).toBe("38px");
    act(() => window.dispatchEvent(new Event("resize")));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
});
