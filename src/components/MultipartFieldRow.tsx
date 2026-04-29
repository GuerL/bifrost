import AppSelect from "./AppSelect.tsx";
import VariableInput, { type VariableStatus } from "../VariableInput.tsx";
import type { MultipartField } from "../types.ts";
import { switchMultipartFieldKind, withFilePath } from "../helpers/requestBodyUtils.ts";

type MultipartFieldRowProps = {
    field: MultipartField;
    onChange: (next: MultipartField) => void;
    onDelete: () => void;
    onPickFile: () => void;
    resolveVariableStatus: (name: string) => VariableStatus;
    resolveVariableValue: (name: string) => string | undefined;
    variableSuggestions: string[];
};

const FIELD_KIND_OPTIONS = [
    { value: "text", label: "Text" },
    { value: "file", label: "File" },
];

export default function MultipartFieldRow({
    field,
    onChange,
    onDelete,
    onPickFile,
    resolveVariableStatus,
    resolveVariableValue,
    variableSuggestions,
}: MultipartFieldRowProps) {
    return (
        <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                    type="checkbox"
                    checked={field.enabled}
                    onChange={(event) => onChange({ ...field, enabled: event.target.checked })}
                    title="Enable field"
                />
                <VariableInput
                    placeholder="name"
                    value={field.name}
                    onChange={(nextName) => onChange({ ...field, name: nextName })}
                    resolveVariableStatus={resolveVariableStatus}
                    resolveVariableValue={resolveVariableValue}
                    variableSuggestions={variableSuggestions}
                    containerStyle={{ flex: 1 }}
                />
                <AppSelect
                    value={field.kind}
                    options={FIELD_KIND_OPTIONS}
                    ariaLabel="Multipart field type"
                    style={{ width: 90 }}
                    onValueChange={(nextValue) =>
                        onChange(
                            switchMultipartFieldKind(
                                field,
                                nextValue === "file" ? "file" : "text"
                            )
                        )
                    }
                />
                <button onClick={onDelete}>-</button>
            </div>
            {field.kind === "text" ? (
                <VariableInput
                    placeholder="value"
                    value={field.value}
                    onChange={(nextValue) => onChange({ ...field, value: nextValue })}
                    resolveVariableStatus={resolveVariableStatus}
                    resolveVariableValue={resolveVariableValue}
                    variableSuggestions={variableSuggestions}
                />
            ) : (
                <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                        <VariableInput
                            placeholder="/path/to/file"
                            value={field.file_path}
                            onChange={(nextPath) => onChange(withFilePath(field, nextPath))}
                            resolveVariableStatus={resolveVariableStatus}
                            resolveVariableValue={resolveVariableValue}
                            variableSuggestions={variableSuggestions}
                            containerStyle={{ flex: 1 }}
                        />
                        <button onClick={onPickFile}>Browse...</button>
                    </div>
                    <span style={{ fontSize: 12, color: "var(--pg-text-muted)" }}>
                        {field.file_name ?? "No file selected"}
                    </span>
                </div>
            )}
        </div>
    );
}
