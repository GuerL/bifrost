import type { Request } from "../../types.ts";

export type JsonObject = Record<string, unknown>;

export type InsomniaV5Meta = {
    id?: string;
    created?: number;
    modified?: number;
    isPrivate?: boolean;
    description?: string;
    sortKey?: number;
};

export type InsomniaV5Header = {
    name?: string;
    value?: string;
    description?: string;
    disabled?: boolean;
};

export type InsomniaV5Parameter = {
    name?: string;
    value?: string;
    description?: string;
    disabled?: boolean;
    type?: string;
    multiline?: boolean;
};

export type InsomniaV5BodyParam = {
    name?: string;
    value?: string;
    description?: string;
    disabled?: boolean;
    multiline?: boolean;
    fileName?: string;
    type?: string;
};

export type InsomniaV5Body = {
    mimeType?: string | null;
    text?: string;
    fileName?: string;
    params?: InsomniaV5BodyParam[];
};

export type InsomniaV5Authentication = {
    type?: string;
    disabled?: boolean;
    [key: string]: unknown;
};

export type InsomniaV5Scripts = {
    preRequest?: string;
    afterResponse?: string;
};

export type InsomniaV5Request = {
    url?: string;
    name?: string;
    meta?: InsomniaV5Meta;
    method?: string;
    body?: InsomniaV5Body;
    parameters?: InsomniaV5Parameter[];
    headers?: InsomniaV5Header[];
    authentication?: InsomniaV5Authentication | Record<string, never>;
    scripts?: InsomniaV5Scripts;
    pathParameters?: InsomniaV5Parameter[] | null;
};

export type InsomniaV5RequestGroup = {
    name?: string;
    meta?: InsomniaV5Meta;
    headers?: InsomniaV5Header[];
    scripts?: InsomniaV5Scripts;
    authentication?: InsomniaV5Authentication | Record<string, never> | null;
    environment?: unknown;
    environmentPropertyOrder?: unknown;
    children?: InsomniaV5CollectionItem[];
};

export type InsomniaV5CollectionItem = InsomniaV5Request | InsomniaV5RequestGroup;

export type InsomniaV5CollectionDocument = {
    type: "collection.insomnia.rest/5.0";
    schema_version?: string;
    name?: string;
    meta?: InsomniaV5Meta;
    collection?: InsomniaV5CollectionItem[];
};

export type InsomniaV5GeneratedRequest = {
    request: Request;
    folderPath: string[];
};

export type InsomniaV5ImportPreview = {
    schemaVersion: string | null;
    requestCount: number;
    folderCount: number;
};

export type InsomniaV5ImportStats = {
    totalItems: number;
    importedRequests: number;
    skippedItems: number;
    folderCount: number;
};

export type InsomniaV5ImportPlan = {
    collectionName: string;
    requests: InsomniaV5GeneratedRequest[];
    preview: InsomniaV5ImportPreview;
    stats: InsomniaV5ImportStats;
    warnings: string[];
};
