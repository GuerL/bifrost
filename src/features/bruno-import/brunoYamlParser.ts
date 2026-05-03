import { parse as parseYaml } from "yaml";
import type { BrunoOpenCollectionDocument, JsonObject } from "./brunoTypes.ts";

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function parseBrunoYamlCollection(fileText: string): BrunoOpenCollectionDocument {
    const trimmed = fileText.trim();
    if (!trimmed) {
        throw new Error("The file is empty.");
    }

    let parsed: unknown;
    try {
        parsed = parseYaml(trimmed);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid YAML syntax. ${reason}`);
    }

    if (!isObject(parsed)) {
        throw new Error("The file must contain a YAML object.");
    }

    const opencollectionVersion = asNonEmptyString(parsed.opencollection);
    if (!opencollectionVersion) {
        throw new Error("Unsupported Bruno/OpenCollection shape: missing 'opencollection' version.");
    }

    if (!isObject(parsed.info)) {
        throw new Error("Unsupported Bruno/OpenCollection shape: missing 'info' object.");
    }

    return {
        ...parsed,
        opencollection: opencollectionVersion,
        info: parsed.info,
    };
}
