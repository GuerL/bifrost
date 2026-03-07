

export default function KeyValueTable({
                           rows,
                           onChange,
                       }: {
    rows: { key: string; value: string }[];
    onChange: (next: { key: string; value: string }[]) => void;
}) {
    return (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {rows.map((kv, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                    <input
                        placeholder="key"
                        value={kv.key}
                        onChange={(e) => {
                            const next = rows.slice();
                            next[i] = { ...kv, key: e.target.value };
                            onChange(next);
                        }}
                    />
                    <input
                        placeholder="value"
                        value={kv.value}
                        onChange={(e) => {
                            const next = rows.slice();
                            next[i] = { ...kv, value: e.target.value };
                            onChange(next);
                        }}
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