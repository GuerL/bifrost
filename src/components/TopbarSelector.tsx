import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import * as Select from "@radix-ui/react-select";

export type TopbarSelectorItem = {
    value: string;
    label: string;
    disabled?: boolean;
};

type TopbarSelectorProps = {
    icon: ReactNode;
    value: string | null;
    items: TopbarSelectorItem[];
    onSelect: (nextValue: string | null) => void;
    placeholder: string;
    emptyOptionLabel?: string;
    width?: number;
    ariaLabel: string;
    onCreate?: () => void;
    onManage?: () => void;
    createLabel?: string;
    manageLabel?: string;
};

const EMPTY_OPTION_VALUE = "__bifrost-topbar-empty__";
const ACTION_CREATE_VALUE = "__bifrost-topbar-action-create__";
const ACTION_MANAGE_VALUE = "__bifrost-topbar-action-manage__";

export default function TopbarSelector({
    icon,
    value,
    items,
    onSelect,
    placeholder,
    emptyOptionLabel,
    width,
    ariaLabel,
    onCreate,
    onManage,
    createLabel,
    manageLabel,
}: TopbarSelectorProps) {
    const [open, setOpen] = useState(false);
    const normalizedValue =
        value && items.some((item) => item.value === value) ? value : EMPTY_OPTION_VALUE;
    const activeLabel = useMemo(() => {
        if (normalizedValue === EMPTY_OPTION_VALUE) {
            return emptyOptionLabel ?? placeholder;
        }
        return items.find((item) => item.value === normalizedValue)?.label ?? placeholder;
    }, [emptyOptionLabel, items, normalizedValue, placeholder]);
    const triggerWidthStyle: CSSProperties | undefined =
        typeof width === "number" ? { width, minWidth: width, maxWidth: width } : undefined;

    return (
        <Select.Root
            open={open}
            onOpenChange={setOpen}
            value={normalizedValue}
            onValueChange={(nextValue) => {
                if (nextValue === ACTION_CREATE_VALUE) {
                    setOpen(false);
                    onCreate?.();
                    return;
                }
                if (nextValue === ACTION_MANAGE_VALUE) {
                    setOpen(false);
                    onManage?.();
                    return;
                }
                onSelect(nextValue === EMPTY_OPTION_VALUE ? null : nextValue);
            }}
        >
            <Select.Trigger
                className="pg-topbar-selector-trigger"
                style={triggerWidthStyle}
                aria-label={ariaLabel}
                title={activeLabel}
            >
                <span className="pg-topbar-selector-icon" aria-hidden>
                    {icon}
                </span>
                <span className="pg-topbar-selector-label">{activeLabel}</span>
                <Select.Icon className="pg-topbar-selector-chevron" aria-hidden>
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
                    className="pg-topbar-selector-content"
                    position="popper"
                    side="bottom"
                    align="start"
                    sideOffset={6}
                >
                    <Select.Viewport className="pg-topbar-selector-viewport">
                        <Select.Item
                            value={EMPTY_OPTION_VALUE}
                            className="pg-topbar-selector-item pg-topbar-selector-item-empty"
                        >
                            <Select.ItemText>
                                <span className="pg-topbar-selector-item-label">
                                    {emptyOptionLabel ?? placeholder}
                                </span>
                            </Select.ItemText>
                            <Select.ItemIndicator className="pg-topbar-selector-item-indicator">
                                ✓
                            </Select.ItemIndicator>
                        </Select.Item>
                        {items.map((item) => (
                            <Select.Item
                                key={item.value}
                                value={item.value}
                                disabled={item.disabled}
                                className="pg-topbar-selector-item"
                                title={item.label}
                            >
                                <Select.ItemText>
                                    <span className="pg-topbar-selector-item-label">{item.label}</span>
                                </Select.ItemText>
                                <Select.ItemIndicator className="pg-topbar-selector-item-indicator">
                                    ✓
                                </Select.ItemIndicator>
                            </Select.Item>
                        ))}
                        {(onCreate || onManage) && (
                            <div className="pg-topbar-selector-separator" aria-hidden />
                        )}
                        {onCreate && createLabel && (
                            <Select.Item
                                value={ACTION_CREATE_VALUE}
                                className="pg-topbar-selector-item pg-topbar-selector-item-action"
                            >
                                <Select.ItemText>
                                    <span className="pg-topbar-selector-item-label">{createLabel}</span>
                                </Select.ItemText>
                            </Select.Item>
                        )}
                        {onManage && manageLabel && (
                            <Select.Item
                                value={ACTION_MANAGE_VALUE}
                                className="pg-topbar-selector-item pg-topbar-selector-item-action"
                            >
                                <Select.ItemText>
                                    <span className="pg-topbar-selector-item-label">{manageLabel}</span>
                                </Select.ItemText>
                            </Select.Item>
                        )}
                    </Select.Viewport>
                </Select.Content>
            </Select.Portal>
        </Select.Root>
    );
}
