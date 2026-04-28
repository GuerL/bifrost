import { type CSSProperties } from "react";
import * as Select from "@radix-ui/react-select";

export type AppSelectOption = {
    value: string;
    label: string;
    disabled?: boolean;
};

type AppSelectProps = {
    value: string;
    options: AppSelectOption[];
    onValueChange: (nextValue: string) => void;
    disabled?: boolean;
    ariaLabel?: string;
    style?: CSSProperties;
};

const EMPTY_VALUE_TOKEN = "__pg-app-select-empty__";

function encodeOptionValue(value: string): string {
    return value === "" ? EMPTY_VALUE_TOKEN : value;
}

function decodeOptionValue(value: string): string {
    return value === EMPTY_VALUE_TOKEN ? "" : value;
}

export default function AppSelect({
    value,
    options,
    onValueChange,
    disabled,
    ariaLabel,
    style,
}: AppSelectProps) {
    const normalizedValue = encodeOptionValue(value);

    return (
        <Select.Root
            value={normalizedValue}
            disabled={disabled}
            onValueChange={(nextValue) => onValueChange(decodeOptionValue(nextValue))}
        >
            <Select.Trigger className="pg-app-select-trigger" style={style} aria-label={ariaLabel}>
                <Select.Value />
                <Select.Icon className="pg-app-select-chevron" aria-hidden>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path
                            d="M6.5 9.25L12 14.75L17.5 9.25"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
                <Select.Content
                    className="pg-app-select-content"
                    position="popper"
                    side="bottom"
                    align="start"
                    sideOffset={6}
                >
                    <Select.Viewport className="pg-app-select-viewport">
                        {options.map((option) => (
                            <Select.Item
                                key={`${option.value}-${option.label}`}
                                value={encodeOptionValue(option.value)}
                                disabled={option.disabled}
                                className="pg-app-select-item"
                                title={option.label}
                            >
                                <Select.ItemText>
                                    <span className="pg-app-select-item-label">{option.label}</span>
                                </Select.ItemText>
                                <Select.ItemIndicator className="pg-app-select-item-indicator">
                                    ✓
                                </Select.ItemIndicator>
                            </Select.Item>
                        ))}
                    </Select.Viewport>
                </Select.Content>
            </Select.Portal>
        </Select.Root>
    );
}
