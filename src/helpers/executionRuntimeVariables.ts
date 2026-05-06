export function buildExecutionVariableValues(args: {
    environmentValues: Map<string, string>;
    runtimeVariables: Record<string, string>;
    runtimeActive: boolean;
}): Map<string, string> {
    const values = new Map(args.environmentValues);
    if (!args.runtimeActive) {
        return values;
    }

    for (const [key, value] of Object.entries(args.runtimeVariables)) {
        const trimmed = key.trim();
        if (!trimmed) continue;
        values.set(trimmed, value);
    }
    return values;
}
