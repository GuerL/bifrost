import { parse as parseYaml } from "yaml";
import type { JsonObject, OpenApiParsedSpec, OpenApiSourceFormat } from "./openApiTypes.ts";

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeVersionToken(value: unknown): string | null {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        if (value === 3) return "3.0";
        if (value === 2) return "2.0";
        return String(value);
    }

    return null;
}

function parseJson(text: string): unknown {
    return JSON.parse(text);
}

function parseYamlText(text: string): unknown {
    return parseYaml(text);
}

function parseDocument(text: string): { value: unknown; sourceFormat: OpenApiSourceFormat } {
    const trimmed = text.trim();
    if (!trimmed) {
        throw new Error("The file is empty.");
    }

    try {
        return { value: parseJson(trimmed), sourceFormat: "json" };
    } catch (jsonError) {
        try {
            return { value: parseYamlText(trimmed), sourceFormat: "yaml" };
        } catch (yamlError) {
            const jsonReason = jsonError instanceof Error ? jsonError.message : String(jsonError);
            const yamlReason = yamlError instanceof Error ? yamlError.message : String(yamlError);
            throw new Error(`Could not parse file as JSON or YAML. JSON: ${jsonReason}. YAML: ${yamlReason}.`);
        }
    }
}

function isSupportedOpenApiVersion(version: string): boolean {
    const [major, minor] = version.split(".");
    return major === "3" && (minor === "0" || minor === "1");
}

function isSupportedSwaggerVersion(version: string): boolean {
    const [major, minor] = version.split(".");
    return major === "2" && minor === "0";
}

function collectExternalRefs(root: unknown): string[] {
    const seen = new Set<object>();
    const refs = new Set<string>();

    const visit = (value: unknown) => {
        if (Array.isArray(value)) {
            for (const entry of value) {
                visit(entry);
            }
            return;
        }

        if (!isObject(value)) {
            return;
        }

        if (seen.has(value)) {
            return;
        }
        seen.add(value);

        const refValue = value.$ref;
        if (typeof refValue === "string" && !refValue.startsWith("#/")) {
            refs.add(refValue);
        }

        for (const nested of Object.values(value)) {
            visit(nested);
        }
    };

    visit(root);
    return Array.from(refs);
}

export function parseOpenApiSpec(fileText: string): OpenApiParsedSpec {
    const parsedDocument = parseDocument(fileText);
    if (!isObject(parsedDocument.value)) {
        throw new Error("The file must contain a JSON/YAML object.");
    }

    const document = parsedDocument.value;
    const openapiVersion = normalizeVersionToken(document.openapi);
    const swaggerVersion = normalizeVersionToken(document.swagger);

    let kind: OpenApiParsedSpec["kind"];
    let specVersion: string;

    if (openapiVersion) {
        if (!isSupportedOpenApiVersion(openapiVersion)) {
            throw new Error(
                `Unsupported OpenAPI version '${openapiVersion}'. Supported versions are OpenAPI 3.0.x and 3.1.x.`
            );
        }
        kind = "openapi3";
        specVersion = openapiVersion;
    } else if (swaggerVersion) {
        if (!isSupportedSwaggerVersion(swaggerVersion)) {
            throw new Error("Unsupported Swagger version. Supported Swagger version is 2.0.");
        }
        kind = "swagger2";
        specVersion = swaggerVersion;
    } else {
        throw new Error("Missing 'openapi' or 'swagger' field.");
    }

    if (!isObject(document.paths)) {
        throw new Error("The specification does not define any paths.");
    }

    const pathCount = Object.keys(document.paths).length;
    if (pathCount === 0) {
        throw new Error("The specification contains an empty paths object.");
    }

    const externalRefs = collectExternalRefs(document);
    const warnings =
        externalRefs.length === 0
            ? []
            : [
                  `External references are not supported and were skipped (${externalRefs.length} found).`,
              ];

    return {
        kind,
        version: specVersion,
        document,
        sourceFormat: parsedDocument.sourceFormat,
        warnings,
    };
}

