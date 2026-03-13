export type CollectionMeta = {
    version: number;
    id: string;
    name: string;
    request_order: string[];
    items: CollectionNode[];
};

export type CollectionFolderNode = {
    type: "folder";
    id: string;
    name: string;
    children: CollectionNode[];
};

export type CollectionRequestRefNode = {
    type: "request_ref";
    request_id: string;
};

export type CollectionNode = CollectionFolderNode | CollectionRequestRefNode;

export type KeyValue = { key: string; value: string };

export type Body =
    | { type: "none" }
    | { type: "raw"; content_type: string; text: string }
    | { type: "json"; value: any; text?: string }
    | { type: "form"; fields: KeyValue[] };

export type RequestAuth =
    | { type: "none" }
    | { type: "bearer"; token: string }
    | { type: "basic"; username: string; password: string }
    | { type: "api_key"; key: string; value: string; in: "header" | "query" };

export type ResponseExtractorRule =
    | { id: string; from: "json_body"; variable: string; path: string }
    | { id: string; from: "header"; variable: string; header: string };

export type RequestScripts = {
    pre_request: string;
    post_response: string;
};

export type Request = {
    id: string;
    name: string;
    method: "get" | "post" | "put" | "patch" | "delete" | "head" | "options";
    url: string;
    headers: KeyValue[];
    query: KeyValue[];
    body: Body;
    auth: RequestAuth;
    extractors: ResponseExtractorRule[];
    scripts: RequestScripts;
};

export type CollectionLoaded = {
    meta: CollectionMeta;
    requests: Request[];
};

export type HttpResponseDto = {
    status: number;
    headers: { key: string; value: string }[];
    body_text: string;
    duration_ms: number;
};

export type EnvironmentVariable = {
    key: string;
    value: string;
};

export type Environment = {
    id: string;
    name: string;
    variables: EnvironmentVariable[];
};

export type ImportPostmanResult = {
    collection_id: string;
    collection_name: string;
    imported_requests: number;
    imported_folders: number;
    imported_environment_id: string | null;
    warnings: string[];
};
