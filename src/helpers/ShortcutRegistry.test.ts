import { describe, expect, it } from "vitest";
import { listShortcuts, shortcutLabel } from "./ShortcutRegistry.ts";

describe("ShortcutRegistry", () => {
    it("exposes shortcuts with centralized labels", () => {
        const shortcuts = listShortcuts();

        expect(shortcuts.find((shortcut) => shortcut.id === "saveDraft")?.label).toBe(
            shortcutLabel("saveDraft")
        );
        expect(shortcuts.find((shortcut) => shortcut.id === "sendRequest")?.title).toBe(
            "Send Request"
        );
    });
});
