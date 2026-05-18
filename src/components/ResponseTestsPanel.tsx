import type { ScriptTestResult } from "../helpers/RequestScriptsRuntime.ts";

type ResponseTestsPanelProps = {
    tests: ScriptTestResult[];
};

export default function ResponseTestsPanel({ tests }: ResponseTestsPanelProps) {
    if (tests.length === 0) {
        return (
            <div style={panelStyle()}>
                <div style={emptyStateStyle()}>No tests were run.</div>
            </div>
        );
    }

    const passed = tests.filter((test) => test.status === "passed").length;
    const failed = tests.length - passed;

    return (
        <div style={panelStyle()}>
            <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 13, color: "var(--pg-text-dim)", fontWeight: 700 }}>
                    {tests.length} test{tests.length === 1 ? "" : "s"} · {passed} passed · {failed} failed
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                    {tests.map((test, index) => {
                        const isPassed = test.status === "passed";
                        return (
                            <div key={`${test.name}-${index}`} style={{ display: "grid", gap: 4 }}>
                                <div
                                    style={{
                                        fontSize: 13,
                                        color: isPassed ? "var(--pg-primary-soft)" : "var(--pg-danger)",
                                        fontWeight: 600,
                                    }}
                                >
                                    {isPassed ? "✅" : "❌"} {test.name}
                                </div>
                                {!isPassed && test.error && (
                                    <div style={{ fontSize: 12, color: "var(--pg-text-muted)", paddingLeft: 22 }}>
                                        {test.error}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function panelStyle(): React.CSSProperties {
    return {
        width: "100%",
        minWidth: 0,
        minHeight: 0,
        flex: 1,
        overflow: "auto",
        borderRadius: 12,
        border: "1px solid var(--pg-border)",
        background: "var(--pg-surface-1)",
        padding: 10,
        boxSizing: "border-box",
    };
}

function emptyStateStyle(): React.CSSProperties {
    return {
        color: "var(--pg-text-muted)",
        fontSize: 13,
    };
}
