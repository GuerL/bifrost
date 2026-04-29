import { invoke } from "@tauri-apps/api/core";
import type { MultipartField } from "../types.ts";
import { createMultipartFileField, createMultipartTextField, withFilePath } from "../helpers/requestBodyUtils.ts";
import MultipartFieldRow from "./MultipartFieldRow.tsx";
import type { VariableStatus } from "../VariableInput.tsx";
import { notifyError } from "../helpers/Toast.tsx";

type MultipartBodyEditorProps = {
    fields: MultipartField[];
    onChange: (next: MultipartField[]) => void;
    resolveVariableStatus: (name: string) => VariableStatus;
    resolveVariableValue: (name: string) => string | undefined;
    variableSuggestions: string[];
};

async function openFileDialog(multiple: boolean): Promise<string[]> {
    const selected = await invoke<string | string[] | null>("plugin:dialog|open", {
        options: {
            directory: false,
            multiple,
        },
    });

    if (!selected) return [];
    if (Array.isArray(selected)) {
        return selected.filter((path) => typeof path === "string" && path.trim().length > 0);
    }
    if (typeof selected === "string" && selected.trim().length > 0) {
        return [selected];
    }
    return [];
}

export default function MultipartBodyEditor({
    fields,
    onChange,
    resolveVariableStatus,
    resolveVariableValue,
    variableSuggestions,
}: MultipartBodyEditorProps) {
    async function onAddFileRows() {
        try {
            const selectedPaths = await openFileDialog(true);
            if (selectedPaths.length === 0) return;
            const nextFields = selectedPaths.map((filePath) => createMultipartFileField(filePath));
            onChange([...fields, ...nextFields]);
        } catch {
            notifyError("Failed to open file picker");
        }
    }

    async function onPickRowFile(fieldId: string) {
        const row = fields.find((entry) => entry.id === fieldId);
        if (!row || row.kind !== "file") return;

        try {
            const selectedPaths = await openFileDialog(false);
            const selectedPath = selectedPaths[0];
            if (!selectedPath) return;
            onChange(
                fields.map((entry) =>
                    entry.id === row.id && entry.kind === "file"
                        ? withFilePath(entry, selectedPath)
                        : entry
                )
            );
        } catch {
            notifyError("Failed to open file picker");
        }
    }

    return (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {fields.map((field) => (
                <MultipartFieldRow
                    key={field.id}
                    field={field}
                    onChange={(nextField) =>
                        onChange(fields.map((entry) => (entry.id === field.id ? nextField : entry)))
                    }
                    onDelete={() =>
                        onChange(fields.filter((entry) => entry.id !== field.id))
                    }
                    onPickFile={() => void onPickRowFile(field.id)}
                    resolveVariableStatus={resolveVariableStatus}
                    resolveVariableValue={resolveVariableValue}
                    variableSuggestions={variableSuggestions}
                />
            ))}

            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => onChange([...fields, createMultipartTextField()])}>
                    + Add field
                </button>
                <button onClick={() => void onAddFileRows()}>+ Add file</button>
            </div>
        </div>
    );
}
