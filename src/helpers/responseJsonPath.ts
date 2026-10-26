type JsonPathNode = {
    start: number;
    end: number;
    parent: JsonPathNode | null;
    segment: string | number | null;
    value: unknown;
};

function propertyAccessors(segments: readonly (string | number)[]): string {
    return segments.map(segment => typeof segment === "number"
        ? `[${segment}]`
        : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)
            ? `.${segment}`
            : `[${JSON.stringify(segment)}]`).join("");
}

export function jsonPathFromSegments(segments: readonly (string | number)[]): string {
    return "$" + propertyAccessors(segments);
}

export function bifrostExpressionFromSegments(segments: readonly (string | number)[]): string {
    return "bf.response.json()" + propertyAccessors(segments);
}

export type JsonContainer = { start: number; valueStart: number; end: number; count: number; array: boolean; depth: number };

export type ResponseJsonIndex = {
    containers: JsonContainer[];
    searchFields: { text: string; offsets: number[] }[];
    segmentsAt: (offset: number) => (string | number)[] | null;
    pathAt: (offset: number) => string | null;
    isContainerAt: (offset: number) => boolean;
    copyAt: (offset: number) => { text: string; container: boolean } | null;
};

/** Index the viewer's canonical, two-space JSON using structure, never token matching.
 * Store parent links rather than full paths so large/deep responses stay compact.
 */
export function indexResponseJson(text: string): ResponseJsonIndex | null {
    let value: unknown;
    try {
        value = JSON.parse(text);
        if (JSON.stringify(value, null, 2) !== text) return null;
    } catch {
        return null;
    }
    const nodes: JsonPathNode[] = [];
    const containers: JsonContainer[] = [];
    const searchFields: ResponseJsonIndex["searchFields"] = [];
    function addField(value: unknown, start: number) {
        const encoded = JSON.stringify(value);
        if (typeof value !== "string") {
            searchFields.push({ text: encoded, offsets: Array.from({ length: encoded.length + 1 }, (_, i) => start + i) });
            return;
        }
        // Map decoded characters back to their exact JSON source spans, including escapes.
        const offsets: number[] = [];
        for (let i = 1; i < encoded.length - 1;) {
            offsets.push(start + i);
            i += encoded[i] === "\\" ? (encoded[i + 1] === "u" ? 6 : 2) : 1;
        }
        offsets.push(start + encoded.length - 1);
        searchFields.push({ text: value, offsets });
    }
    let cursor = 0;
    function visit(value: unknown, parent: JsonPathNode | null, segment: string | number | null, depth: number, keyStart?: number) {
        const node: JsonPathNode = { start: keyStart ?? cursor, end: 0, parent, segment, value };
        nodes.push(node);
        if (value !== null && typeof value === "object") {
            const array = Array.isArray(value);
            const entries = Object.entries(value);
            const container: JsonContainer = { start: node.start, valueStart: cursor, end: 0, count: entries.length, array, depth };
            containers.push(container);
            cursor++; // Opening brace/bracket.
            entries.forEach(([key, child], index) => {
                cursor += 1 + (depth + 1) * 2; // Newline and indentation.
                const start = cursor;
                if (!array) addField(key, cursor);
                if (!array) cursor += JSON.stringify(key).length + 2; // Key and ': '.
                visit(child, node, array ? index : key, depth + 1, start);
                if (index < entries.length - 1) cursor++; // Comma.
            });
            if (entries.length) cursor += 1 + depth * 2;
            cursor++; // Closing brace/bracket.
            container.end = cursor;
        } else {
            addField(value, cursor);
            cursor += JSON.stringify(value).length;
        }
        node.end = cursor;
    }
    try {
        visit(value, null, null, 0);
    } catch {
        // Extremely deep input must not prevent the response from being displayed.
        return null;
    }
    function nodeAt(offset: number): JsonPathNode | null {
        if (!Number.isInteger(offset) || offset < 0 || offset >= text.length) return null;
        // Last node starting at/before the clicked offset, then its containing ancestor.
        let low = 0, high = nodes.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (nodes[mid].start <= offset) low = mid + 1;
            else high = mid;
        }
        let node: JsonPathNode | null = nodes[low - 1];
        while (node && offset >= node.end) node = node.parent;
        return node;
    }
    function segmentsAt(offset: number): (string | number)[] | null {
        let node = nodeAt(offset);
        if (!node) return null;
        const segments: (string | number)[] = [];
        while (node.parent) {
            segments.push(node.segment!);
            node = node.parent;
        }
        return segments.reverse();
    }
    return {
        containers,
        searchFields,
        segmentsAt,
        isContainerAt(offset) {
            const node = nodeAt(offset);
            return !!node && node.value !== null && typeof node.value === "object";
        },
        copyAt(offset) {
            const node = nodeAt(offset);
            if (!node) return null;
            return {
                text: typeof node.value === "string" ? node.value : JSON.stringify(node.value, null, 2),
                container: node.value !== null && typeof node.value === "object",
            };
        },
        pathAt(offset) {
            const segments = segmentsAt(offset);
            return segments === null ? null : jsonPathFromSegments(segments);
        },
    };
}

/** Read the hit-tested text position without moving the selection or caret. */
export function responseTextOffsetAtPoint(root: HTMLElement, x: number, y: number): number | null {
    const doc = root.ownerDocument as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const position = doc.caretPositionFromPoint?.(x, y);
    const caret = position ? null : doc.caretRangeFromPoint?.(x, y);
    const node = position?.offsetNode ?? caret?.startContainer;
    const offset = position?.offset ?? caret?.startOffset;
    if (!node || offset === undefined || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null;
    const span = node.parentElement?.closest<HTMLElement>("[data-json-offset]");
    if (!span || !root.contains(span)) return null;
    // Reject clicks in blank space where browser hit testing snaps to nearby text.
    const character = doc.createRange();
    const length = node.textContent?.length ?? 0;
    const hit = [offset, offset - 1].find(candidate => {
        if (candidate < 0 || candidate >= length) return false;
        character.setStart(node, candidate);
        character.setEnd(node, candidate + 1);
        return Array.from(character.getClientRects()).some(rect =>
            x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
    });
    if (hit === undefined) return null;
    const prefix = doc.createRange();
    prefix.selectNodeContents(span);
    prefix.setEnd(node, character.startOffset);
    return Number(span.dataset.jsonOffset) + (span.hasAttribute("data-json-anchor") ? 0 : prefix.toString().length);
}
