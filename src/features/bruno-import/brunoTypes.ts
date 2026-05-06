import type { KeyValue, Request } from "../../types.ts";

export type JsonObject = Record<string, unknown>;

export type BrunoOpenCollectionDocument = JsonObject & {
    opencollection: string;
    info: JsonObject;
    items?: unknown;
    request?: unknown;
    bundled?: unknown;
};

export type BrunoGeneratedRequest = {
    request: Request;
    folderPath: string[];
};

export type BrunoImportPreview = {
    sourceVersion: string;
    bundled: boolean | null;
    requestCount: number;
    folderCount: number;
};

export type BrunoImportStats = {
    totalItems: number;
    importedRequests: number;
    skippedItems: number;
    folderCount: number;
};

export type BrunoImportPlan = {
    collectionName: string;
    requests: BrunoGeneratedRequest[];
    preview: BrunoImportPreview;
    stats: BrunoImportStats;
    warnings: string[];
};

export type BrunoRequestDefaults = {
    headers: KeyValue[];
    hasAuth: boolean;
    auth: unknown | null;
};
