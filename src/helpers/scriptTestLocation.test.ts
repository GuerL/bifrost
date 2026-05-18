import { describe, expect, it } from "vitest";
import { mapScriptTestCallLocations } from "./scriptTestLocation.ts";

describe("mapScriptTestCallLocations", () => {
    it("maps bf.test calls to line/column", () => {
        const script = `const first = 1;
bf.test("a", () => {});

  bf . test("b", () => {});
`;

        const locations = mapScriptTestCallLocations(script);

        expect(locations).toEqual([
            { line: 2, column: 1 },
            { line: 4, column: 3 },
        ]);
    });

    it("maps pg.test calls", () => {
        const script = `pg.test("one", () => {});\nconst x = 1;\npg.test("two", () => {});`;
        const locations = mapScriptTestCallLocations(script);

        expect(locations).toEqual([
            { line: 1, column: 1 },
            { line: 3, column: 1 },
        ]);
    });

    it("returns empty array when script has no tests", () => {
        expect(mapScriptTestCallLocations("const x = 1;")).toEqual([]);
    });
});
