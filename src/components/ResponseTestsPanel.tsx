import { useEffect, useMemo, useState } from "react";
import type { ScriptTestResult } from "../helpers/RequestScriptsRuntime.ts";
import {
    defaultTestSectionsExpansion,
    groupScriptTests,
} from "../helpers/responseTestsGrouping.ts";

type ResponseTestsPanelProps = {
    tests: ScriptTestResult[];
    onRevealScriptTestLocation?: (test: ScriptTestResult) => void;
};

export default function ResponseTestsPanel({
    tests,
    onRevealScriptTestLocation,
}: ResponseTestsPanelProps) {
    const { failed, passed } = useMemo(() => groupScriptTests(tests), [tests]);
    const [failedExpanded, setFailedExpanded] = useState(false);
    const [passedExpanded, setPassedExpanded] = useState(false);

    useEffect(() => {
        const defaults = defaultTestSectionsExpansion(tests);
        setFailedExpanded(defaults.failedExpanded);
        setPassedExpanded(defaults.passedExpanded);
    }, [tests]);

    if (tests.length === 0) {
        return (
            <div style={panelStyle()}>
                <div style={emptyStateStyle()}>No tests were run.</div>
            </div>
        );
    }

    return (
        <div style={panelStyle()}>
            <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 13, color: "var(--pg-text-dim)", fontWeight: 700 }}>
                    {tests.length} test{tests.length === 1 ? "" : "s"} · {passed.length} passed · {failed.length} failed
                </div>

                <TestSection
                    title="Failed"
                    count={failed.length}
                    expanded={failedExpanded}
                    onToggle={() => setFailedExpanded((previous) => !previous)}
                    emptyLabel="No failed tests."
                >
                    {failed.map((test, index) => (
                        <FailedTestRow
                            key={`${test.name}-${index}`}
                            test={test}
                            onRevealScriptTestLocation={onRevealScriptTestLocation}
                        />
                    ))}
                </TestSection>

                <TestSection
                    title="Passed"
                    count={passed.length}
                    expanded={passedExpanded}
                    onToggle={() => setPassedExpanded((previous) => !previous)}
                    emptyLabel="No passed tests."
                >
                    {passed.map((test, index) => (
                        <div key={`${test.name}-${index}`} style={testRowStyle()}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <StatusIcon status="passed" />
                                <span style={{ fontSize: 13, color: "var(--pg-success)", fontWeight: 600 }}>
                                    {test.name}
                                </span>
                            </div>
                        </div>
                    ))}
                </TestSection>
            </div>
        </div>
    );
}

function TestSection({
    title,
    count,
    expanded,
    onToggle,
    emptyLabel,
    children,
}: {
    title: string;
    count: number;
    expanded: boolean;
    onToggle: () => void;
    emptyLabel: string;
    children: React.ReactNode;
}) {
    return (
        <div style={{ display: "grid", gap: 8 }}>
            <button onClick={onToggle} style={sectionToggleStyle()}>
                <ChevronIcon expanded={expanded} />
                <span>{title}</span>
                <span style={{ color: "var(--pg-text-muted)", marginLeft: 4 }}>({count})</span>
            </button>

            {expanded && (
                <div style={{ display: "grid", gap: 8, paddingLeft: 4 }}>
                    {count === 0 ? <div style={emptySectionStyle()}>{emptyLabel}</div> : children}
                </div>
            )}
        </div>
    );
}

function FailedTestRow({
    test,
    onRevealScriptTestLocation,
}: {
    test: ScriptTestResult;
    onRevealScriptTestLocation?: (test: ScriptTestResult) => void;
}) {
    const clickable = !!onRevealScriptTestLocation;

    return (
        <div style={testRowStyle()}>
            <button
                onClick={() => {
                    if (!onRevealScriptTestLocation) return;
                    onRevealScriptTestLocation(test);
                }}
                disabled={!clickable}
                style={failedTestButtonStyle(clickable)}
                title={
                    typeof test.line === "number"
                        ? `Open script at line ${test.line}`
                        : "Open script"
                }
            >
                <StatusIcon status="failed" />
                <span style={{ fontSize: 13, color: "var(--pg-danger)", fontWeight: 600, textAlign: "left" }}>
                    {test.name}
                </span>
                {typeof test.line === "number" && (
                    <span style={{ fontSize: 11, color: "var(--pg-text-muted)", marginLeft: "auto" }}>
                        line {test.line}
                    </span>
                )}
            </button>
            {test.error && (
                <div style={{ fontSize: 12, color: "var(--pg-text-muted)", paddingLeft: 28, lineHeight: 1.45 }}>
                    {test.error}
                </div>
            )}
        </div>
    );
}

function StatusIcon({ status }: { status: "passed" | "failed" }) {
    if (status === "passed") {
        return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="var(--pg-success)" strokeWidth="2" />
                <path
                    d="M8 12.5L10.8 15.2L16 10"
                    stroke="var(--pg-success)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        );
    }

    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="var(--pg-danger)" strokeWidth="2" />
            <path d="M9 9L15 15" stroke="var(--pg-danger)" strokeWidth="2" strokeLinecap="round" />
            <path d="M15 9L9 15" stroke="var(--pg-danger)" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 120ms ease" }}
        >
            <path
                d="M9 6L15 12L9 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
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

function sectionToggleStyle(): React.CSSProperties {
    return {
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "fit-content",
        padding: 0,
        border: "none",
        background: "transparent",
        boxShadow: "none",
        color: "var(--pg-text-dim)",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
    };
}

function testRowStyle(): React.CSSProperties {
    return {
        display: "grid",
        gap: 4,
    };
}

function failedTestButtonStyle(clickable: boolean): React.CSSProperties {
    return {
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        border: "1px solid rgba(239, 68, 68, 0.28)",
        background: "rgba(239, 68, 68, 0.08)",
        boxShadow: "none",
        borderRadius: 8,
        padding: "6px 8px",
        cursor: clickable ? "pointer" : "default",
        textAlign: "left",
    };
}

function emptySectionStyle(): React.CSSProperties {
    return {
        fontSize: 12,
        color: "var(--pg-text-muted)",
    };
}
