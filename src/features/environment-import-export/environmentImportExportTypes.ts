import type { Environment, KeyValue } from "../../types.ts";

export const BIFROST_ENVIRONMENT_EXPORT_TYPE = "bifrost-environment";
export const BIFROST_ENVIRONMENT_EXPORT_VERSION = 1;

export type EnvironmentConflictStrategy = "merge" | "duplicate" | "rename";

export type VariableConflictStrategy = "overwrite" | "skip" | "rename";

export type BifrostEnvironmentExportFile = {
    type: typeof BIFROST_ENVIRONMENT_EXPORT_TYPE;
    version: typeof BIFROST_ENVIRONMENT_EXPORT_VERSION;
    environment: {
        name: string;
        variables: Record<string, string>;
    };
};

export type EnvironmentTransferVariable = {
    key: string;
    value: string;
    sensitive: boolean;
};

export type EnvironmentExportVariable = EnvironmentTransferVariable & {
    selectedByDefault: boolean;
};

export type ParsedBifrostEnvironmentImport = {
    type: typeof BIFROST_ENVIRONMENT_EXPORT_TYPE;
    version: number;
    environment: {
        name: string;
        variables: EnvironmentTransferVariable[];
    };
};

export type BuildEnvironmentImportPlanOptions = {
    parsedImport: ParsedBifrostEnvironmentImport;
    existingEnvironments: Environment[];
    selectedVariableKeys: string[];
    environmentConflictStrategy: EnvironmentConflictStrategy;
    variableConflictStrategy: VariableConflictStrategy;
    renamedEnvironmentName?: string;
};

export type EnvironmentImportPlan = {
    targetEnvironmentId: string | null;
    targetEnvironmentName: string;
    variables: KeyValue[];
    variableConflicts: string[];
    createsNewEnvironment: boolean;
};
