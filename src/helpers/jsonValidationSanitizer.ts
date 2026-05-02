const TEMPLATE_OPEN = "{{";
const TEMPLATE_CLOSE = "}}";
const OUTSIDE_TEMPLATE_PLACEHOLDER = "\"0\"";

function buildOutsidePlaceholder(length: number): string {
    if (length <= OUTSIDE_TEMPLATE_PLACEHOLDER.length) {
        return OUTSIDE_TEMPLATE_PLACEHOLDER.slice(0, length);
    }
    return `${OUTSIDE_TEMPLATE_PLACEHOLDER}${" ".repeat(length - OUTSIDE_TEMPLATE_PLACEHOLDER.length)}`;
}

export function sanitizeJsonForValidation(text: string): string {
    let out = "";
    let i = 0;
    let inString = false;
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;

    while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1] ?? "";

        if (inLineComment) {
            out += ch;
            if (ch === "\n") {
                inLineComment = false;
            }
            i += 1;
            continue;
        }

        if (inBlockComment) {
            out += ch;
            if (ch === "*" && next === "/") {
                out += next;
                i += 2;
                inBlockComment = false;
                continue;
            }
            i += 1;
            continue;
        }

        if (inString) {
            if (ch === "{" && next === "{") {
                const closeIndex = text.indexOf(TEMPLATE_CLOSE, i + TEMPLATE_OPEN.length);
                if (closeIndex !== -1) {
                    const rawLength = closeIndex + TEMPLATE_CLOSE.length - i;
                    out += "x".repeat(rawLength);
                    i = closeIndex + TEMPLATE_CLOSE.length;
                    continue;
                }
            }

            out += ch;
            if (escaped) {
                escaped = false;
                i += 1;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                i += 1;
                continue;
            }
            if (ch === "\"") {
                inString = false;
            }
            i += 1;
            continue;
        }

        if (ch === "/" && next === "/") {
            out += ch;
            out += next;
            inLineComment = true;
            i += 2;
            continue;
        }

        if (ch === "/" && next === "*") {
            out += ch;
            out += next;
            inBlockComment = true;
            i += 2;
            continue;
        }

        if (ch === "{" && next === "{") {
            const closeIndex = text.indexOf(TEMPLATE_CLOSE, i + TEMPLATE_OPEN.length);
            if (closeIndex !== -1) {
                const rawLength = closeIndex + TEMPLATE_CLOSE.length - i;
                out += buildOutsidePlaceholder(rawLength);
                i = closeIndex + TEMPLATE_CLOSE.length;
                continue;
            }
        }

        out += ch;
        if (ch === "\"") {
            inString = true;
            escaped = false;
        }
        i += 1;
    }

    return out;
}
