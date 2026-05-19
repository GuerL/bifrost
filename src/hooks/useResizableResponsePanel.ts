import {
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type RefObject,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

type UseResizableResponsePanelArgs = {
    containerRef: RefObject<HTMLElement | null>;
    containerElement?: HTMLElement | null;
    storageKeyPrefix?: string;
    defaultRequestRatio?: number;
    dividerHeightPx?: number;
    minRequestHeightPx?: number;
    minResponseHeightPx?: number;
};

type DragState = {
    startY: number;
    startRequestHeightPx: number;
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function readStoredNumber(key: string, fallback: number): number {
    if (typeof window === "undefined") return fallback;
    try {
        const value = Number(window.localStorage.getItem(key));
        return Number.isFinite(value) ? value : fallback;
    } catch {
        return fallback;
    }
}

function writeStoredNumber(key: string, value: number) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, String(value));
    } catch {
        // ignore storage write failures
    }
}

export function useResizableResponsePanel({
    containerRef,
    containerElement,
    storageKeyPrefix = "bifrost:response-panel",
    defaultRequestRatio = 0.55,
    dividerHeightPx = 6,
    minRequestHeightPx = 44,
    minResponseHeightPx = 112,
}: UseResizableResponsePanelArgs) {
    const ratioStorageKey = `${storageKeyPrefix}:request-ratio:v1`;
    const [requestRatio, setRequestRatio] = useState<number>(() =>
        clamp(readStoredNumber(ratioStorageKey, defaultRequestRatio), 0, 1)
    );
    const [containerHeightPx, setContainerHeightPx] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const dragStateRef = useRef<DragState | null>(null);

    useEffect(() => {
        writeStoredNumber(ratioStorageKey, requestRatio);
    }, [ratioStorageKey, requestRatio]);

    useEffect(() => {
        const element = containerElement ?? containerRef.current;
        if (!element) return;

        const updateHeight = () => {
            setContainerHeightPx(element.getBoundingClientRect().height);
        };
        updateHeight();

        if (typeof ResizeObserver === "undefined") {
            window.addEventListener("resize", updateHeight);
            return () => window.removeEventListener("resize", updateHeight);
        }

        const observer = new ResizeObserver(() => updateHeight());
        observer.observe(element);
        return () => observer.disconnect();
    }, [containerElement, containerRef]);

    const availableHeightPx =
        containerHeightPx > dividerHeightPx
            ? Math.max(1, containerHeightPx - dividerHeightPx)
            : Math.max(1, minRequestHeightPx + minResponseHeightPx);

    const bounds = useMemo(() => {
        const maxRequest = Math.max(0, availableHeightPx - minResponseHeightPx);
        const minRequest = Math.min(minRequestHeightPx, maxRequest);
        return {
            minRequest,
            maxRequest: Math.max(minRequest, maxRequest),
        };
    }, [availableHeightPx, minRequestHeightPx, minResponseHeightPx]);

    const clampRatioToBounds = useCallback(
        (candidateRatio: number) => {
            const candidateRequestHeight = candidateRatio * availableHeightPx;
            const requestHeight = clamp(
                candidateRequestHeight,
                bounds.minRequest,
                bounds.maxRequest
            );
            return clamp(requestHeight / availableHeightPx, 0, 1);
        },
        [availableHeightPx, bounds.maxRequest, bounds.minRequest]
    );

    useEffect(() => {
        setRequestRatio((previous) => clampRatioToBounds(previous));
    }, [clampRatioToBounds]);

    useEffect(() => {
        if (!isDragging) return;

        function onMouseMove(event: MouseEvent) {
            const dragState = dragStateRef.current;
            if (!dragState) return;
            const deltaY = event.clientY - dragState.startY;
            const nextRequestHeight = dragState.startRequestHeightPx + deltaY;
            setRequestRatio(clampRatioToBounds(nextRequestHeight / availableHeightPx));
        }

        function onMouseUp() {
            setIsDragging(false);
            dragStateRef.current = null;
        }

        const bodyStyle = document.body.style;
        const rootStyle = document.documentElement.style;
        const previousBodyCursor = bodyStyle.cursor;
        const previousBodyUserSelect = bodyStyle.userSelect;
        const previousRootUserSelect = rootStyle.userSelect;
        const previousBodyWebkitUserSelect = bodyStyle.getPropertyValue("-webkit-user-select");
        const previousRootWebkitUserSelect = rootStyle.getPropertyValue("-webkit-user-select");

        bodyStyle.cursor = "row-resize";
        bodyStyle.userSelect = "none";
        rootStyle.userSelect = "none";
        bodyStyle.setProperty("-webkit-user-select", "none");
        rootStyle.setProperty("-webkit-user-select", "none");

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            bodyStyle.cursor = previousBodyCursor;
            bodyStyle.userSelect = previousBodyUserSelect;
            rootStyle.userSelect = previousRootUserSelect;
            bodyStyle.setProperty("-webkit-user-select", previousBodyWebkitUserSelect || "");
            rootStyle.setProperty("-webkit-user-select", previousRootWebkitUserSelect || "");
        };
    }, [availableHeightPx, clampRatioToBounds, isDragging]);

    const requestHeightPx = clamp(
        requestRatio * availableHeightPx,
        bounds.minRequest,
        bounds.maxRequest
    );
    const responseHeightPx = Math.max(0, availableHeightPx - requestHeightPx);

    const onDividerMouseDown = useCallback(
        (event: ReactMouseEvent<HTMLDivElement>) => {
            if (event.button !== 0) return;
            dragStateRef.current = {
                startY: event.clientY,
                startRequestHeightPx: requestHeightPx,
            };
            setIsDragging(true);
        },
        [requestHeightPx]
    );

    const onDividerKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLDivElement>) => {
            const step = 24;
            if (event.key === "ArrowUp") {
                event.preventDefault();
                const nextRequestHeight = requestHeightPx - step;
                setRequestRatio(clampRatioToBounds(nextRequestHeight / availableHeightPx));
                return;
            }
            if (event.key === "ArrowDown") {
                event.preventDefault();
                const nextRequestHeight = requestHeightPx + step;
                setRequestRatio(clampRatioToBounds(nextRequestHeight / availableHeightPx));
            }
        },
        [availableHeightPx, clampRatioToBounds, requestHeightPx]
    );

    return {
        dividerHeightPx,
        requestHeightPx,
        responseHeightPx,
        isDragging,
        onDividerMouseDown,
        onDividerKeyDown,
    };
}
