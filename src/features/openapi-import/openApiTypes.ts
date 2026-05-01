import type { Request } from "../../types.ts";

export type JsonObject = Record<string, unknown>;

export type OpenApiSpecKind = "openapi3" | "swagger2";
export type OpenApiSourceFormat = "json" | "yaml";

export type OpenApiParsedSpec = {
    kind: OpenApiSpecKind;
    version: string;
    document: JsonObject;
    sourceFormat: OpenApiSourceFormat;
    warnings: string[];
};

export type OpenApiGroupingStrategy = "tags" | "path_segment" | "root";

export type OpenApiGeneratedRequest = {
    request: Request;
    methodLabel: string;
    originalPath: string;
    folderName: string | null;
};

export type OpenApiImportPreview = {
    title: string;
    version: string;
    pathCount: number;
    requestCount: number;
    serverUrl: string | null;
};

export type OpenApiImportStats = {
    totalPaths: number;
    importedOperations: number;
    skippedExternalPathRefs: number;
    skippedUnsupportedPaths: number;
};

export type OpenApiImportPlan = {
    collectionName: string;
    specKind: OpenApiSpecKind;
    specVersion: string;
    preview: OpenApiImportPreview;
    stats: OpenApiImportStats;
    grouping: OpenApiGroupingStrategy;
    requests: OpenApiGeneratedRequest[];
    warnings: string[];
};
