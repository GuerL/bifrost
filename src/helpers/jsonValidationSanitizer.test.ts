import { describe, expect, it } from "vitest";
import { sanitizeJsonForValidation } from "./jsonValidationSanitizer.ts";

describe("sanitizeJsonForValidation", () => {
    it("neutralizes bifrost template variables in JSON values", () => {
        const input = `{
  "id": {{newCreatedFamily}},
  "name": "{{uuid}}"
}`;

        const sanitized = sanitizeJsonForValidation(input);

        expect(sanitized).not.toContain("{{newCreatedFamily}}");
        expect(sanitized).not.toContain("{{uuid}}");
        expect(() => JSON.parse(sanitized)).not.toThrow();
    });

    it("keeps strict JSON errors for real syntax mistakes", () => {
        const input = `{
  "id": {{newCreatedFamily}},
}`;

        const sanitized = sanitizeJsonForValidation(input);

        expect(() => JSON.parse(sanitized)).toThrow();
    });

    it("supports variable placeholders as object keys", () => {
        const input = `{
  {{dynamicKey}}: 1
}`;

        const sanitized = sanitizeJsonForValidation(input);

        expect(() => JSON.parse(sanitized)).not.toThrow();
    });

    it("does not alter JSON without template placeholders", () => {
        const input = `{
  "ok": true,
  "count": 2
}`;

        expect(sanitizeJsonForValidation(input)).toBe(input);
    });
});
