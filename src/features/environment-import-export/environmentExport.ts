import type { Environment, KeyValue } from "../../types.ts";
import {
    BIFROST_ENVIRONMENT_EXPORT_TYPE,
    BIFROST_ENVIRONMENT_EXPORT_VERSION,
    type BifrostEnvironmentExportFile,
    type EnvironmentExportVariable,
} from "./environmentImportExportTypes.ts";
import { isSensitiveVariable } from "./sensitiveVariableDetection.ts";

export function normalizeEnvironmentVariables(variables: KeyValue[]): KeyValue[] {
    const uniqueByKey = new Map<string, string>();

    for (const variable of variables) {
        const key = variable.key.trim();
        if (!key) {
            continue;
        }
        uniqueByKey.set(key, variable.value ?? "");
    }

    return Array.from(uniqueByKey.entries()).map(([key, value]) => ({ key, value }));
}

export function buildEnvironmentExportVariables(environment: Environment): EnvironmentExportVariable[] {
    return normalizeEnvironmentVariables(environment.variables).map((variable) => {
        const sensitive = isSensitiveVariable(variable.key);
        return {
            ...variable,
            sensitive,
            selectedByDefault: !sensitive,
        };
    });
}

export function buildEnvironmentExportPayload(
    environmentName: string,
    variables: KeyValue[]
): BifrostEnvironmentExportFile {
    const normalizedVariables = normalizeEnvironmentVariables(variables);
    const payloadVariables = normalizedVariables.reduce<Record<string, string>>((acc, variable) => {
        acc[variable.key] = variable.value;
        return acc;
    }, {});

    return {
        type: BIFROST_ENVIRONMENT_EXPORT_TYPE,
        version: BIFROST_ENVIRONMENT_EXPORT_VERSION,
        environment: {
            name: environmentName,
            variables: payloadVariables,
        },
    };
}

export function stringifyEnvironmentExportPayload(payload: BifrostEnvironmentExportFile): string {
    return JSON.stringify(payload, null, 2);
}
