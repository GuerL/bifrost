export type ScriptTestCallLocation = {
    line: number;
    column: number;
};

const SCRIPT_TEST_CALL_PATTERN = /\b(?:bf|pg)\s*\.\s*test\s*\(/g;

function indexToLineColumn(script: string, index: number): ScriptTestCallLocation {
    let line = 1;
    let column = 1;

    for (let cursor = 0; cursor < index; cursor += 1) {
        if (script[cursor] === "\n") {
            line += 1;
            column = 1;
            continue;
        }
        column += 1;
    }

    return { line, column };
}

export function mapScriptTestCallLocations(script: string): ScriptTestCallLocation[] {
    const locations: ScriptTestCallLocation[] = [];
    if (!script) return locations;

    SCRIPT_TEST_CALL_PATTERN.lastIndex = 0;

    for (const match of script.matchAll(SCRIPT_TEST_CALL_PATTERN)) {
        const index = match.index ?? -1;
        if (index < 0) continue;
        locations.push(indexToLineColumn(script, index));
    }

    return locations;
}
