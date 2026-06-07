type ShortcutId =
    | "newRequest"
    | "saveDraft"
    | "sendRequest"
    | "duplicateRequest"
    | "copyRequest"
    | "copyAsCurl"
    | "closeTab"
    | "nextTab"
    | "previousTab"
    | "renameRequest"
    | "deleteRequest";

type ShortcutDefinition = {
    id: ShortcutId;
    title: string;
    keys: string[];
    shift?: boolean;
};

const IS_MACOS =
    typeof navigator !== "undefined" &&
    /(Mac|iPhone|iPad|iPod)/i.test(navigator.userAgent);
const PRIMARY_SHORTCUT_MODIFIER = IS_MACOS ? "CMD" : "CTRL";

const SHORTCUTS: ShortcutDefinition[] = [
    { id: "newRequest", title: "Open New Request", keys: ["t"] },
    { id: "saveDraft", title: "Save Request", keys: ["s"] },
    { id: "sendRequest", title: "Send Request", keys: ["enter"] },
    { id: "duplicateRequest", title: "Duplicate Request", keys: ["d"] },
    { id: "copyRequest", title: "Copy Request", keys: ["c"] },
    { id: "copyAsCurl", title: "Copy as cURL", keys: ["c"], shift: true },
    { id: "closeTab", title: "Close Tab", keys: ["w"] },
    { id: "nextTab", title: "Next Tab", keys: ["]"] },
    { id: "previousTab", title: "Previous Tab", keys: ["["] },
    { id: "renameRequest", title: "Rename Request", keys: ["e"] },
    {
        id: "deleteRequest",
        title: "Delete Request",
        keys: IS_MACOS ? ["backspace"] : ["delete"],
    },
] as const;

function displayKey(key: string): string {
    if (key === "enter") return "Enter";
    if (key === "backspace") return "Backspace";
    if (key === "delete") return "Delete";
    return key.length === 1 ? key.toUpperCase() : key;
}

function findShortcut(id: ShortcutId): ShortcutDefinition {
    const shortcut = SHORTCUTS.find((entry) => entry.id === id);
    if (!shortcut) {
        throw new Error(`Unknown shortcut: ${id}`);
    }
    return shortcut;
}

export function shortcutLabel(id: ShortcutId): string {
    const shortcut = findShortcut(id);
    const parts = [PRIMARY_SHORTCUT_MODIFIER];
    if (shortcut.shift) {
        parts.push("SHIFT");
    }
    parts.push(displayKey(shortcut.keys[0] ?? ""));
    return parts.join(" + ");
}

export function matchesShortcut(event: KeyboardEvent, id: ShortcutId): boolean {
    const shortcut = findShortcut(id);
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return false;
    }
    if (Boolean(shortcut.shift) !== event.shiftKey) {
        return false;
    }

    const key = event.key.toLowerCase();
    return shortcut.keys.includes(key);
}

export function listShortcuts(): Array<{ id: ShortcutId; title: string; label: string }> {
    return SHORTCUTS.map((shortcut) => ({
        id: shortcut.id,
        title: shortcut.title,
        label: shortcutLabel(shortcut.id),
    }));
}
