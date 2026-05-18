const SCRIPT_ASSERTABLE_MARKER = Symbol("bifrost.scriptAssertable");

type ScriptAssertableMarker = {
    [SCRIPT_ASSERTABLE_MARKER]: true;
};

export type ScriptTestResult = {
    name: string;
    status: "passed" | "failed";
    error: string | null;
    durationMs?: number;
};

export type ScriptExpectation = {
    toBe: (expected: unknown) => void;
    toEqual: (expected: unknown) => void;
    toContain: (expected: unknown) => void;
    toBeDefined: () => void;
    toBeTruthy: () => void;
    toBeFalsy: () => void;
    not: {
        toBe: (expected: unknown) => void;
        toEqual: (expected: unknown) => void;
    };
};

export type ScriptAssertableValue<T> = ScriptExpectation & {
    valueOf: () => T;
    toString: () => string;
};

export type ScriptTestCollector = {
    test: (name: string, callback: () => void) => void;
    getResults: () => ScriptTestResult[];
};

export function stringifyScriptError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function nowMs(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
    }
    return Date.now();
}

function isObjectLike(value: unknown): value is Record<string | symbol, unknown> {
    return value !== null && typeof value === "object";
}

function isScriptAssertableValue(value: unknown): value is ScriptAssertableValue<unknown> & ScriptAssertableMarker {
    return isObjectLike(value) && value[SCRIPT_ASSERTABLE_MARKER] === true && typeof value.valueOf === "function";
}

function normalizeValue<T>(value: T): T | unknown {
    if (isScriptAssertableValue(value)) {
        return value.valueOf();
    }
    return value;
}

function formatValue(value: unknown): string {
    const normalized = normalizeValue(value);

    if (typeof normalized === "string") {
        return `"${normalized}"`;
    }
    if (typeof normalized === "number" || typeof normalized === "boolean" || typeof normalized === "bigint") {
        return String(normalized);
    }
    if (normalized === undefined) return "undefined";
    if (normalized === null) return "null";
    if (typeof normalized === "function") {
        return `[Function ${normalized.name || "anonymous"}]`;
    }
    if (normalized instanceof Date) {
        return `Date(${normalized.toISOString()})`;
    }

    try {
        return JSON.stringify(normalized);
    } catch {
        return Object.prototype.toString.call(normalized);
    }
}

function typedArrayEqual(left: ArrayBufferView, right: ArrayBufferView): boolean {
    if (left.constructor !== right.constructor) return false;

    const leftBytes = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
    const rightBytes = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
    if (leftBytes.length !== rightBytes.length) return false;

    for (let index = 0; index < leftBytes.length; index += 1) {
        if (leftBytes[index] !== rightBytes[index]) return false;
    }

    return true;
}

function arrayBufferEqual(left: ArrayBuffer, right: ArrayBuffer): boolean {
    if (left.byteLength !== right.byteLength) return false;

    const leftBytes = new Uint8Array(left);
    const rightBytes = new Uint8Array(right);

    for (let index = 0; index < leftBytes.length; index += 1) {
        if (leftBytes[index] !== rightBytes[index]) return false;
    }

    return true;
}

function deepEqualInternal(leftInput: unknown, rightInput: unknown, visited: WeakMap<object, object>): boolean {
    const left = normalizeValue(leftInput);
    const right = normalizeValue(rightInput);

    if (Object.is(left, right)) return true;

    if (typeof left !== typeof right) return false;

    if (left === null || right === null) return false;

    if (typeof left !== "object" || typeof right !== "object") return false;

    if (left instanceof Date && right instanceof Date) {
        return Object.is(left.getTime(), right.getTime());
    }

    if (left instanceof RegExp && right instanceof RegExp) {
        return left.source === right.source && left.flags === right.flags;
    }

    if (ArrayBuffer.isView(left) && ArrayBuffer.isView(right)) {
        return typedArrayEqual(left, right);
    }

    if (left instanceof ArrayBuffer && right instanceof ArrayBuffer) {
        return arrayBufferEqual(left, right);
    }

    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right)) return false;
        if (left.length !== right.length) return false;

        for (let index = 0; index < left.length; index += 1) {
            if (!deepEqualInternal(left[index], right[index], visited)) return false;
        }

        return true;
    }

    const leftMapped = visited.get(left as object);
    if (leftMapped) {
        return leftMapped === right;
    }
    visited.set(left as object, right as object);

    if (left instanceof Map || right instanceof Map) {
        if (!(left instanceof Map) || !(right instanceof Map)) return false;
        if (left.size !== right.size) return false;

        for (const [key, leftValue] of left.entries()) {
            if (!right.has(key)) return false;
            if (!deepEqualInternal(leftValue, right.get(key), visited)) return false;
        }

        return true;
    }

    if (left instanceof Set || right instanceof Set) {
        if (!(left instanceof Set) || !(right instanceof Set)) return false;
        if (left.size !== right.size) return false;

        const rightValues = Array.from(right.values());
        const consumed = new Set<number>();

        for (const leftValue of left.values()) {
            let foundIndex = -1;
            for (let index = 0; index < rightValues.length; index += 1) {
                if (consumed.has(index)) continue;
                if (!deepEqualInternal(leftValue, rightValues[index], visited)) continue;
                foundIndex = index;
                break;
            }

            if (foundIndex === -1) return false;
            consumed.add(foundIndex);
        }

        return true;
    }

    const leftPrototype = Object.getPrototypeOf(left);
    const rightPrototype = Object.getPrototypeOf(right);
    if (leftPrototype !== rightPrototype) return false;

    const leftKeys = Reflect.ownKeys(left);
    const rightKeys = Reflect.ownKeys(right);

    if (leftKeys.length !== rightKeys.length) return false;

    const rightKeySet = new Set(rightKeys);
    for (const key of leftKeys) {
        if (!rightKeySet.has(key)) return false;
        const leftValue = (left as Record<string | symbol, unknown>)[key];
        const rightValue = (right as Record<string | symbol, unknown>)[key];
        if (!deepEqualInternal(leftValue, rightValue, visited)) return false;
    }

    return true;
}

function deepEqual(left: unknown, right: unknown): boolean {
    return deepEqualInternal(left, right, new WeakMap());
}

export function createScriptExpect(actualInput: unknown): ScriptExpectation {
    const actual = normalizeValue(actualInput);

    const toBe = (expectedInput: unknown) => {
        const expected = normalizeValue(expectedInput);
        if (!Object.is(actual, expected)) {
            throw new Error(`Expected ${formatValue(actual)} to be ${formatValue(expected)}`);
        }
    };

    const toEqual = (expectedInput: unknown) => {
        const expected = normalizeValue(expectedInput);
        if (!deepEqual(actual, expected)) {
            throw new Error(`Expected ${formatValue(actual)} to equal ${formatValue(expected)}`);
        }
    };

    return {
        toBe,
        toEqual,
        toContain: (expectedInput: unknown) => {
            const expected = normalizeValue(expectedInput);
            if (typeof actual === "string") {
                const substring = String(expected ?? "");
                if (!actual.includes(substring)) {
                    throw new Error(`Expected ${formatValue(actual)} to contain ${formatValue(substring)}`);
                }
                return;
            }

            if (Array.isArray(actual)) {
                const found = actual.some((entry) => deepEqual(entry, expected));
                if (!found) {
                    throw new Error(`Expected ${formatValue(actual)} to contain ${formatValue(expected)}`);
                }
                return;
            }

            throw new Error(
                `toContain() expects a string or an array, received ${Object.prototype.toString.call(actual)}`
            );
        },
        toBeDefined: () => {
            if (actual === undefined) {
                throw new Error("Expected value to be defined");
            }
        },
        toBeTruthy: () => {
            if (!actual) {
                throw new Error(`Expected ${formatValue(actual)} to be truthy`);
            }
        },
        toBeFalsy: () => {
            if (actual) {
                throw new Error(`Expected ${formatValue(actual)} to be falsy`);
            }
        },
        not: {
            toBe: (expectedInput: unknown) => {
                const expected = normalizeValue(expectedInput);
                if (Object.is(actual, expected)) {
                    throw new Error(`Expected ${formatValue(actual)} not to be ${formatValue(expected)}`);
                }
            },
            toEqual: (expectedInput: unknown) => {
                const expected = normalizeValue(expectedInput);
                if (deepEqual(actual, expected)) {
                    throw new Error(`Expected ${formatValue(actual)} not to equal ${formatValue(expected)}`);
                }
            },
        },
    };
}

export function createScriptAssertableValue<T>(actual: T): ScriptAssertableValue<T> {
    const expectation = createScriptExpect(actual) as ScriptAssertableValue<T> & ScriptAssertableMarker;
    expectation.valueOf = () => actual;
    expectation.toString = () => String(actual);
    Object.defineProperty(expectation, SCRIPT_ASSERTABLE_MARKER, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: true,
    });
    return expectation;
}

export function createScriptTestCollector(): ScriptTestCollector {
    const results: ScriptTestResult[] = [];

    return {
        test: (name: string, callback: () => void) => {
            const normalizedName = String(name ?? "").trim() || "Unnamed test";
            const startedAt = nowMs();
            try {
                if (typeof callback !== "function") {
                    throw new Error("bf.test(name, callback): callback must be a function");
                }
                callback();
                const durationMs = Math.max(0, Math.round(nowMs() - startedAt));
                results.push({
                    name: normalizedName,
                    status: "passed",
                    error: null,
                    ...(durationMs > 0 ? { durationMs } : {}),
                });
            } catch (error) {
                const durationMs = Math.max(0, Math.round(nowMs() - startedAt));
                results.push({
                    name: normalizedName,
                    status: "failed",
                    error: stringifyScriptError(error),
                    ...(durationMs > 0 ? { durationMs } : {}),
                });
            }
        },
        getResults: () => results.map((result) => ({ ...result })),
    };
}
