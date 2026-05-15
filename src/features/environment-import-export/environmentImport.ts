import type { Environment, KeyValue } from "../../types.ts";
import { normalizeEnvironmentVariables } from "./environmentExport.ts";
import {
    BIFROST_ENVIRONMENT_EXPORT_TYPE,
    BIFROST_ENVIRONMENT_EXPORT_VERSION,
    type BuildEnvironmentImportPlanOptions,
    type EnvironmentImportPlan,
    type ParsedBifrostEnvironmentImport,
    type VariableConflictStrategy,
} from "./environmentImportExportTypes.ts";
import { isSensitiveVariable } from "./sensitiveVariableDetection.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeEnvironmentName(value: string): string {
    return value.trim().toLowerCase();
}

function ensureUniqueEnvironmentName(baseName: string, existingNames: string[]): string {
    const trimmedBaseName = baseName.trim() || "Imported Environment";
    const lowerExisting = new Set(existingNames.map((name) => normalizeEnvironmentName(name)));
    if (!lowerExisting.has(normalizeEnvironmentName(trimmedBaseName))) {
        return trimmedBaseName;
    }

    const copyBase = `${trimmedBaseName} Copy`;
    if (!lowerExisting.has(normalizeEnvironmentName(copyBase))) {
        return copyBase;
    }

    let suffix = 2;
    while (true) {
        const candidate = `${trimmedBaseName} Copy ${suffix}`;
        if (!lowerExisting.has(normalizeEnvironmentName(candidate))) {
            return candidate;
        }
        suffix += 1;
    }
}

function ensureUniqueVariableKey(baseKey: string, existingKeys: Set<string>): string {
    let candidate = `${baseKey}_imported`;
    if (!existingKeys.has(candidate)) {
        return candidate;
    }

    let suffix = 2;
    while (true) {
        candidate = `${baseKey}_imported_${suffix}`;
        if (!existingKeys.has(candidate)) {
            return candidate;
        }
        suffix += 1;
    }
}

export function parseEnvironmentImportJson(jsonText: string): ParsedBifrostEnvironmentImport {
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        throw new Error("Invalid JSON");
    }

    if (!isRecord(parsed)) {
        throw new Error("Malformed structure: expected object root");
    }

    if (parsed.type !== BIFROST_ENVIRONMENT_EXPORT_TYPE) {
        throw new Error("Malformed structure: unsupported environment export type");
    }

    if (typeof parsed.version !== "number" || !Number.isInteger(parsed.version)) {
        throw new Error("Malformed structure: missing or invalid version");
    }

    if (parsed.version !== BIFROST_ENVIRONMENT_EXPORT_VERSION) {
        throw new Error(`Unsupported version: ${parsed.version}`);
    }

    const environment = parsed.environment;
    if (!isRecord(environment)) {
        throw new Error("Malformed structure: missing environment object");
    }

    const rawEnvironmentName = environment.name;
    if (typeof rawEnvironmentName !== "string" || !rawEnvironmentName.trim()) {
        throw new Error("Malformed structure: environment name is missing");
    }

    const rawVariables = environment.variables;
    if (!isRecord(rawVariables)) {
        throw new Error("Malformed structure: environment variables must be an object");
    }

    const variables = Object.entries(rawVariables).map(([rawKey, rawValue]) => {
        const key = rawKey.trim();
        if (!key) {
            throw new Error("Malformed structure: variable key cannot be empty");
        }
        if (typeof rawValue !== "string") {
            throw new Error(`Malformed structure: variable '${key}' must be a string`);
        }
        return {
            key,
            value: rawValue,
            sensitive: isSensitiveVariable(key),
        };
    });

    return {
        type: BIFROST_ENVIRONMENT_EXPORT_TYPE,
        version: parsed.version,
        environment: {
            name: rawEnvironmentName.trim(),
            variables,
        },
    };
}

export function findEnvironmentByName(
    environments: Environment[],
    name: string
): Environment | null {
    const normalizedName = normalizeEnvironmentName(name);
    if (!normalizedName) {
        return null;
    }

    return (
        environments.find(
            (environment) => normalizeEnvironmentName(environment.name) === normalizedName
        ) ?? null
    );
}

export function listVariableConflicts(
    existingVariables: KeyValue[],
    importedVariables: KeyValue[]
): string[] {
    const existingKeys = new Set(
        normalizeEnvironmentVariables(existingVariables).map((variable) => variable.key)
    );

    return normalizeEnvironmentVariables(importedVariables)
        .filter((variable) => existingKeys.has(variable.key))
        .map((variable) => variable.key);
}

export function mergeEnvironmentVariables(
    existingVariables: KeyValue[],
    importedVariables: KeyValue[],
    strategy: VariableConflictStrategy
): KeyValue[] {
    const mergedMap = new Map<string, string>();

    for (const variable of normalizeEnvironmentVariables(existingVariables)) {
        mergedMap.set(variable.key, variable.value);
    }

    const normalizedImported = normalizeEnvironmentVariables(importedVariables);

    for (const variable of normalizedImported) {
        const alreadyExists = mergedMap.has(variable.key);
        if (!alreadyExists) {
            mergedMap.set(variable.key, variable.value);
            continue;
        }

        if (strategy === "overwrite") {
            mergedMap.set(variable.key, variable.value);
            continue;
        }

        if (strategy === "skip") {
            continue;
        }

        const uniqueKey = ensureUniqueVariableKey(variable.key, new Set(mergedMap.keys()));
        mergedMap.set(uniqueKey, variable.value);
    }

    return Array.from(mergedMap.entries()).map(([key, value]) => ({ key, value }));
}

export function buildEnvironmentImportPlan(
    options: BuildEnvironmentImportPlanOptions
): EnvironmentImportPlan {
    const {
        parsedImport,
        existingEnvironments,
        selectedVariableKeys,
        environmentConflictStrategy,
        variableConflictStrategy,
        renamedEnvironmentName,
    } = options;

    const selectedKeySet = new Set(selectedVariableKeys.map((value) => value.trim()).filter(Boolean));
    const selectedImportedVariables = normalizeEnvironmentVariables(
        parsedImport.environment.variables
            .filter((variable) => selectedKeySet.has(variable.key))
            .map((variable) => ({ key: variable.key, value: variable.value }))
    );

    const matchingEnvironment = findEnvironmentByName(
        existingEnvironments,
        parsedImport.environment.name
    );

    let targetEnvironmentId: string | null = null;
    let targetEnvironmentName = parsedImport.environment.name;
    let existingTargetVariables: KeyValue[] = [];
    let createsNewEnvironment = true;

    if (environmentConflictStrategy === "merge" && matchingEnvironment) {
        targetEnvironmentId = matchingEnvironment.id;
        targetEnvironmentName = matchingEnvironment.name;
        existingTargetVariables = matchingEnvironment.variables;
        createsNewEnvironment = false;
    } else if (environmentConflictStrategy === "duplicate") {
        targetEnvironmentName = ensureUniqueEnvironmentName(
            parsedImport.environment.name,
            existingEnvironments.map((environment) => environment.name)
        );
    } else if (environmentConflictStrategy === "rename") {
        const renamed = renamedEnvironmentName?.trim() ?? "";
        if (!renamed) {
            throw new Error("Please provide a name for the imported environment.");
        }
        const nameTaken = findEnvironmentByName(existingEnvironments, renamed);
        if (nameTaken) {
            throw new Error("An environment with that name already exists.");
        }
        targetEnvironmentName = renamed;
    } else if (
        environmentConflictStrategy === "merge" &&
        !matchingEnvironment
    ) {
        targetEnvironmentName = parsedImport.environment.name;
    }

    const variableConflicts = listVariableConflicts(
        existingTargetVariables,
        selectedImportedVariables
    );

    const nextVariables = targetEnvironmentId
        ? mergeEnvironmentVariables(
            existingTargetVariables,
            selectedImportedVariables,
            variableConflictStrategy
        )
        : selectedImportedVariables;

    return {
        targetEnvironmentId,
        targetEnvironmentName,
        variables: nextVariables,
        variableConflicts,
        createsNewEnvironment,
    };
}
