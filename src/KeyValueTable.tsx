import VariableInput, { type VariableStatus } from "./VariableInput.tsx";

type KeyValueTableProps = {
    rows: { key: string; value: string }[];
    onChange: (next: { key: string; value: string }[]) => void;
    resolveVariableStatus?: (name: string) => VariableStatus;
    resolveVariableValue?: (name: string) => string | undefined;
    variableSuggestions?: string[];
};

export default function KeyValueTable({
    rows,
    onChange,
    resolveVariableStatus,
    resolveVariableValue,
    variableSuggestions,
}: KeyValueTableProps) {
    return (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {rows.map((kv, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                    <VariableInput
                        placeholder="key"
                        value={kv.key}
                        onChange={(nextKey) => {
                            const next = rows.slice();
                            next[i] = { ...kv, key: nextKey };
                            onChange(next);
                        }}
                        resolveVariableStatus={resolveVariableStatus}
                        resolveVariableValue={resolveVariableValue}
                        variableSuggestions={variableSuggestions}
                        containerStyle={{ flex: 1 }}
                    />
                    <VariableInput
                        placeholder="value"
                        value={kv.value}
                        onChange={(nextValue) => {
                            const next = rows.slice();
                            next[i] = { ...kv, value: nextValue };
                            onChange(next);
                        }}
                        resolveVariableStatus={resolveVariableStatus}
                        resolveVariableValue={resolveVariableValue}
                        variableSuggestions={variableSuggestions}
                        containerStyle={{ flex: 1 }}
                    />
                    <button
                        onClick={() => {
                            const next = rows.slice();
                            next.splice(i, 1);
                            onChange(next);
                        }}
                    >
                        -
                    </button>
                </div>
            ))}
            <button onClick={() => onChange([...rows, { key: "", value: "" }])}>+ Add</button>
        </div>
    );
}
