export type MultipartTextField = {
    id: string;
    enabled: boolean;
    kind: "text";
    name: string;
    value: string;
};

export type MultipartFileField = {
    id: string;
    enabled: boolean;
    kind: "file";
    name: string;
    file_path: string;
    file_name?: string;
    mime_type?: string;
    size?: number;
};

export type MultipartField = MultipartTextField | MultipartFileField;
