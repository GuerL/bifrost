import type { MultipartField, MultipartFileField, MultipartTextField } from "./requestBodyTypes.ts";
import type { Request } from "../types.ts";

export type MultipartValidationIssue = {
    rowIndex: number;
    rowId: string;
    message: string;
};

export type PreparedRequestResult =
    | { ok: true; request: Request }
    | { ok: false; message: string };

export function fileNameFromPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const segments = normalized.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 0) return filePath;
    return segments[segments.length - 1];
}

export function createMultipartTextField(): MultipartTextField {
    return {
        id: crypto.randomUUID(),
        enabled: true,
        kind: "text",
        name: "",
        value: "",
    };
}

export function createMultipartFileField(filePath = ""): MultipartFileField {
    const normalizedPath = filePath.trim();
    return {
        id: crypto.randomUUID(),
        enabled: true,
        kind: "file",
        name: "",
        file_path: normalizedPath,
        file_name: normalizedPath ? fileNameFromPath(normalizedPath) : undefined,
    };
}

export function withFilePath(field: MultipartFileField, filePath: string): MultipartFileField {
    const normalizedPath = filePath.trim();
    return {
        ...field,
        file_path: normalizedPath,
        file_name: normalizedPath ? fileNameFromPath(normalizedPath) : undefined,
    };
}

export function switchMultipartFieldKind(
    field: MultipartField,
    nextKind: MultipartField["kind"]
): MultipartField {
    if (field.kind === nextKind) {
        return field;
    }

    if (nextKind === "text") {
        return {
            id: field.id,
            enabled: field.enabled,
            kind: "text",
            name: field.name,
            value: "",
        };
    }

    return {
        id: field.id,
        enabled: field.enabled,
        kind: "file",
        name: field.name,
        file_path: "",
        file_name: undefined,
    };
}

export function enabledMultipartFields(fields: MultipartField[]): MultipartField[] {
    return fields.filter((field) => field.enabled !== false);
}

export function validateMultipartFields(fields: MultipartField[]): MultipartValidationIssue[] {
    const issues: MultipartValidationIssue[] = [];
    const activeFields = enabledMultipartFields(fields);

    for (const [index, field] of activeFields.entries()) {
        if (field.name.trim().length === 0) {
            issues.push({
                rowIndex: index,
                rowId: field.id,
                message: "Enabled multipart rows must have a field name.",
            });
            continue;
        }

        if (field.kind === "file" && field.file_path.trim().length === 0) {
            issues.push({
                rowIndex: index,
                rowId: field.id,
                message: `File field '${field.name}' has no file selected.`,
            });
        }
    }

    return issues;
}

function normalizeMultipartFields(fields: MultipartField[]): MultipartField[] {
    return enabledMultipartFields(fields).map((field) => {
        if (field.kind === "text") {
            return {
                ...field,
                name: field.name.trim(),
            };
        }

        const filePath = field.file_path.trim();
        return {
            ...field,
            name: field.name.trim(),
            file_path: filePath,
            file_name: field.file_name?.trim() || (filePath ? fileNameFromPath(filePath) : undefined),
        };
    });
}

export function prepareRequestForExecution(request: Request): PreparedRequestResult {
    if (request.body.type !== "multipart") {
        return { ok: true, request };
    }

    const issues = validateMultipartFields(request.body.fields);
    if (issues.length > 0) {
        return { ok: false, message: issues[0].message };
    }

    return {
        ok: true,
        request: {
            ...request,
            body: {
                type: "multipart",
                fields: normalizeMultipartFields(request.body.fields),
            },
        },
    };
}
