import { parse as parseYaml } from "yaml";
import type { InsomniaV5CollectionDocument, JsonObject } from "./insomniaV5Types.ts";

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function unsupportedFormatError(): Error {
    return new Error(
        "Unsupported Insomnia version or format. Expected an Insomnia V5 YAML/JSON export with type 'collection.insomnia.rest/5.0'."
    );
}

function parseDocument(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch (jsonError) {
        try {
            return parseYaml(text);
        } catch (yamlError) {
            const jsonReason = jsonError instanceof Error ? jsonError.message : String(jsonError);
            const yamlReason = yamlError instanceof Error ? yamlError.message : String(yamlError);
            throw new Error(`Could not parse file as JSON or YAML. JSON: ${jsonReason}. YAML: ${yamlReason}.`);
        }
    }
}

export function parseInsomniaV5Collection(fileText: string): InsomniaV5CollectionDocument {
    const trimmed = fileText.trim();
    if (!trimmed) {
        throw new Error("The file is empty.");
    }

    const parsed = parseDocument(trimmed);

    if (!isObject(parsed)) {
        throw new Error("The file must contain a JSON/YAML object.");
    }

    const typeValue = asNonEmptyString(parsed.type);
    if (typeValue !== "collection.insomnia.rest/5.0") {
        if (parsed._type === "export" || typeof parsed.__export_format === "number") {
            throw unsupportedFormatError();
        }
        throw unsupportedFormatError();
    }

    const schemaVersion = asNonEmptyString(parsed.schema_version);
    if (schemaVersion) {
        const major = Number.parseInt(schemaVersion.split(".")[0] ?? "", 10);
        if (!Number.isNaN(major) && major !== 5) {
            throw unsupportedFormatError();
        }
    }

    const collectionValue = parsed.collection;
    if (collectionValue !== undefined && !Array.isArray(collectionValue)) {
        throw new Error("Unsupported Insomnia V5 shape: 'collection' must be an array.");
    }

    return {
        ...parsed,
        type: "collection.insomnia.rest/5.0",
        schema_version: schemaVersion ?? undefined,
        collection: Array.isArray(collectionValue) ? collectionValue : undefined,
    };
}
