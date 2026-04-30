type JsonObject = Record<string, unknown>;

export type ResolveLocalRef = (ref: string) => unknown | null;

export type BuildSchemaExampleOptions = {
    resolveRef: ResolveLocalRef;
    maxDepth?: number;
};

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function pickFirstExampleFromExamples(examples: unknown): unknown {
    if (Array.isArray(examples)) {
        return examples.find((entry) => entry !== undefined);
    }
    if (!isObject(examples)) {
        return undefined;
    }

    for (const value of Object.values(examples)) {
        if (isObject(value) && "value" in value) {
            return value.value;
        }
        if (value !== undefined) {
            return value;
        }
    }
    return undefined;
}

function schemaType(schema: JsonObject): string | null {
    return typeof schema.type === "string" ? schema.type : null;
}

function buildSchemaExampleInternal(
    schemaInput: unknown,
    options: Required<BuildSchemaExampleOptions>,
    depth: number,
    visitedRefs: Set<string>
): unknown {
    if (!isObject(schemaInput)) {
        return undefined;
    }

    const explicitExample = schemaInput.example;
    if (explicitExample !== undefined) {
        return explicitExample;
    }

    const examplesCandidate = pickFirstExampleFromExamples(schemaInput.examples);
    if (examplesCandidate !== undefined) {
        return examplesCandidate;
    }

    if (schemaInput.default !== undefined) {
        return schemaInput.default;
    }

    if (schemaInput.const !== undefined) {
        return schemaInput.const;
    }

    if (Array.isArray(schemaInput.enum) && schemaInput.enum.length > 0) {
        return schemaInput.enum[0];
    }

    if (depth >= options.maxDepth) {
        return undefined;
    }

    const ref = typeof schemaInput.$ref === "string" ? schemaInput.$ref : null;
    if (ref) {
        if (visitedRefs.has(ref)) {
            return undefined;
        }
        visitedRefs.add(ref);
        const resolved = options.resolveRef(ref);
        const resolvedExample = buildSchemaExampleInternal(
            resolved,
            options,
            depth + 1,
            visitedRefs
        );
        visitedRefs.delete(ref);
        return resolvedExample;
    }

    if (Array.isArray(schemaInput.oneOf) && schemaInput.oneOf.length > 0) {
        return buildSchemaExampleInternal(
            schemaInput.oneOf[0],
            options,
            depth + 1,
            visitedRefs
        );
    }

    if (Array.isArray(schemaInput.anyOf) && schemaInput.anyOf.length > 0) {
        return buildSchemaExampleInternal(
            schemaInput.anyOf[0],
            options,
            depth + 1,
            visitedRefs
        );
    }

    if (Array.isArray(schemaInput.allOf) && schemaInput.allOf.length > 0) {
        const merged: JsonObject = {};
        let hadObject = false;

        for (const child of schemaInput.allOf) {
            const sample = buildSchemaExampleInternal(
                child,
                options,
                depth + 1,
                visitedRefs
            );
            if (isObject(sample)) {
                Object.assign(merged, sample);
                hadObject = true;
                continue;
            }
            if (!hadObject && sample !== undefined) {
                return sample;
            }
        }

        return hadObject ? merged : undefined;
    }

    const type = schemaType(schemaInput);
    if (type === "string") {
        return "string";
    }
    if (type === "number" || type === "integer") {
        return 0;
    }
    if (type === "boolean") {
        return true;
    }
    if (type === "array") {
        const itemSample = buildSchemaExampleInternal(
            schemaInput.items,
            options,
            depth + 1,
            visitedRefs
        );
        return itemSample === undefined ? [] : [itemSample];
    }

    if (type === "object" || isObject(schemaInput.properties) || isObject(schemaInput.additionalProperties)) {
        const result: JsonObject = {};
        if (isObject(schemaInput.properties)) {
            for (const [propertyName, propertySchema] of Object.entries(schemaInput.properties)) {
                const propertySample = buildSchemaExampleInternal(
                    propertySchema,
                    options,
                    depth + 1,
                    visitedRefs
                );
                if (propertySample !== undefined) {
                    result[propertyName] = propertySample;
                }
            }
        } else if (isObject(schemaInput.additionalProperties)) {
            const additional = buildSchemaExampleInternal(
                schemaInput.additionalProperties,
                options,
                depth + 1,
                visitedRefs
            );
            if (additional !== undefined) {
                result.additionalProp1 = additional;
            }
        }
        return result;
    }

    return undefined;
}

export function buildSchemaExample(
    schemaInput: unknown,
    options: BuildSchemaExampleOptions
): unknown {
    const normalizedOptions: Required<BuildSchemaExampleOptions> = {
        resolveRef: options.resolveRef,
        maxDepth: options.maxDepth ?? 6,
    };
    return buildSchemaExampleInternal(
        schemaInput,
        normalizedOptions,
        0,
        new Set<string>()
    );
}

