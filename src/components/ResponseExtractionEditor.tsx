import VariableInput, { type VariableStatus } from "../VariableInput.tsx";
import type { ResponseExtractorRule } from "../types.ts";
import { buttonStyle } from "../helpers/UiStyles.ts";
import AppSelect from "./AppSelect.tsx";

type ResponseExtractionEditorProps = {
    rules: ResponseExtractorRule[];
    onChange: (next: ResponseExtractorRule[]) => void;
    resolveVariableStatus?: (name: string) => VariableStatus;
    resolveVariableValue?: (name: string) => string | undefined;
    variableSuggestions?: string[];
};

function createRule(): ResponseExtractorRule {
    return {
        id: crypto.randomUUID(),
        from: "json_body",
        variable: "",
        path: "",
    };
}

const EXTRACTION_SOURCE_OPTIONS = [
    { value: "json_body", label: "JSON body" },
    { value: "header", label: "Header" },
];

export default function ResponseExtractionEditor({
    rules,
    onChange,
    resolveVariableStatus,
    resolveVariableValue,
    variableSuggestions,
}: ResponseExtractionEditorProps) {
    return (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {rules.length === 0 && (
                <div style={{ fontSize: 13, color: "var(--pg-text-muted)" }}>
                    No extraction rule yet.
                </div>
            )}

            {rules.map((rule, index) => (
                <div
                    key={rule.id || `${rule.from}-${index}`}
                    style={{
                        display: "grid",
                        gridTemplateColumns: "170px minmax(0, 1fr) minmax(0, 1fr) auto",
                        gap: 8,
                        alignItems: "center",
                    }}
                >
                    <AppSelect
                        value={rule.from}
                        options={EXTRACTION_SOURCE_OPTIONS}
                        ariaLabel="Extraction source"
                        style={{ width: "100%" }}
                        onValueChange={(nextValue) => {
                            const from = nextValue as ResponseExtractorRule["from"];
                            const next = rules.slice();
                            next[index] =
                                from === "json_body"
                                    ? {
                                        id: rule.id || crypto.randomUUID(),
                                        from: "json_body",
                                        variable: rule.variable,
                                        path: rule.from === "json_body" ? rule.path : "",
                                    }
                                    : {
                                        id: rule.id || crypto.randomUUID(),
                                        from: "header",
                                        variable: rule.variable,
                                        header: rule.from === "header" ? rule.header : "",
                                    };
                            onChange(next);
                        }}
                    />

                    <VariableInput
                        placeholder="Variable name (ex: authToken)"
                        value={rule.variable}
                        onChange={(variable) => {
                            const next = rules.slice();
                            next[index] = { ...rule, variable };
                            onChange(next);
                        }}
                        resolveVariableStatus={resolveVariableStatus}
                        resolveVariableValue={resolveVariableValue}
                        variableSuggestions={variableSuggestions}
                    />

                    {rule.from === "json_body" ? (
                        <input
                            value={rule.path}
                            onChange={(event) => {
                                const next = rules.slice();
                                next[index] = { ...rule, path: event.target.value };
                                onChange(next);
                            }}
                            placeholder="JSON path (ex: data.token)"
                        />
                    ) : (
                        <input
                            value={rule.header}
                            onChange={(event) => {
                                const next = rules.slice();
                                next[index] = { ...rule, header: event.target.value };
                                onChange(next);
                            }}
                            placeholder="Header name (ex: x-token)"
                        />
                    )}

                    <button
                        onClick={() => {
                            const next = rules.slice();
                            next.splice(index, 1);
                            onChange(next);
                        }}
                        style={buttonStyle(false)}
                    >
                        Remove
                    </button>
                </div>
            ))}

            <div>
                <button onClick={() => onChange([...rules, createRule()])} style={buttonStyle(false)}>
                    + Add extraction
                </button>
            </div>
        </div>
    );
}
