import VariableInput, { type VariableStatus } from "../VariableInput.tsx";
import type { ResponseExtractorRule } from "../types.ts";
import { buttonStyle, selectStyle } from "../helpers/UiStyles.ts";

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
                    <select
                        value={rule.from}
                        onChange={(event) => {
                            const from = event.target.value as ResponseExtractorRule["from"];
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
                        style={selectStyle()}
                    >
                        <option value="json_body">JSON body</option>
                        <option value="header">Header</option>
                    </select>

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
