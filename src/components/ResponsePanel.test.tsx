import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ResponsePanel from "./ResponsePanel.tsx";

function render(body_text: string) {
    return renderToStaticMarkup(<ResponsePanel response={{ body_text, status: 200, headers: [], duration_ms: 1 }}
        statusText="OK" scriptReport={null} runtimeVariables={{}} onClearRuntimeVariables={() => {}}
        activeTab="body" onTabChange={() => {}} requestId="request" />);
}

describe("response JSON disclosure integration", () => {
    it("renders semantic, labelled disclosure buttons with expanded state and original text offsets", () => {
        const html = render('{"user.name":[{"id":42}],"empty":{}}');
        expect(html).toContain('aria-label="Collapse $" aria-expanded="true"');
        expect(html).toContain('aria-label="Collapse $[&quot;user.name&quot;]" aria-expanded="true"');
        expect(html.match(/class="pg-json-disclosure"/g)).toHaveLength(3);
        expect(html).toContain('type="button"');
        expect(html).toContain('data-json-offset=');
        expect(html).toContain('Collapse All');
        expect(html).toContain('Expand All');
        expect(html).toContain('42');
    });

    it.each(['{}', '[]', 'null', '42', '"hello"', '{invalid', '<html>hello</html>'])("keeps empty, primitive, invalid and non-JSON responses readable: %s", body => {
        const html = render(body);
        expect(html).not.toContain('class="pg-json-disclosure"');
        expect(html).not.toContain('Collapse All');
        expect(html).toContain('aria-label="Response body"');
    });
});
