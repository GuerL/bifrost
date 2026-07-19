import VariableInput, { type VariableStatus } from "./VariableInput.tsx";
import { buttonStyle } from "./helpers/UiStyles.ts";

type KeyValueTableProps = {
    rows: { key: string; value: string; enabled?: boolean }[];
    onChange: (next: { key: string; value: string; enabled?: boolean }[]) => void;
    resolveVariableStatus?: (name: string) => VariableStatus;
    resolveVariableValue?: (name: string) => string | undefined;
    variableSuggestions?: string[];
    showEnabledToggle?: boolean;
    enabledToggleTitle?: string;
    disabled?: boolean;
};

export default function KeyValueTable({
    rows,
    onChange,
    resolveVariableStatus,
    resolveVariableValue,
    variableSuggestions,
    showEnabledToggle,
    enabledToggleTitle,
    disabled = false,
}: KeyValueTableProps) {
    return (
        <div style={{ display: "grid", gap: 8 }}>
            {rows.map((kv, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                    {showEnabledToggle && (
                        <label
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                minWidth: 28,
                            }}
                            title={enabledToggleTitle}
                        >
                            <input
                                type="checkbox"
                                checked={kv.enabled !== false}
                                disabled={disabled}
                                onChange={(event) => {
                                    const next = rows.slice();
                                    next[i] = { ...kv, enabled: event.target.checked };
                                    onChange(next);
                                }}
                            />
                        </label>
                    )}
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
                        disabled={disabled}
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
                        disabled={disabled}
                    />
                    <button
                        onClick={() => {
                            const next = rows.slice();
                            next.splice(i, 1);
                            onChange(next);
                        }}
                        disabled={disabled}
                        style={{
                            ...buttonStyle(disabled),
                            width: 30,
                            minWidth: 30,
                            padding: 0,
                            fontSize: 14,
                            lineHeight: 1,
                            flexShrink: 0,
                        }}
                        title="Remove row"
                    >
                        −
                    </button>
                </div>
            ))}
            <button
                disabled={disabled}
                onClick={() =>
                    onChange([
                        ...rows,
                        {
                            key: "",
                            value: "",
                            ...(showEnabledToggle ? { enabled: true } : {}),
                        },
                    ])
                }
                style={{
                    ...buttonStyle(disabled),
                    width: "fit-content",
                    paddingInline: 12,
                }}
            >
                + Add
            </button>
        </div>
    );
}
