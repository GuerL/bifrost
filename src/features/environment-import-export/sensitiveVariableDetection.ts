const SENSITIVE_VARIABLE_PATTERNS = [
    "token",
    "accesstoken",
    "refreshtoken",
    "password",
    "secret",
    "apikey",
    "bearer",
    "jwt",
    "authorization",
    "auth",
] as const;

export function normalizeVariableNameForSensitivity(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveVariable(name: string): boolean {
    const normalized = normalizeVariableNameForSensitivity(name);
    if (!normalized) {
        return false;
    }

    return SENSITIVE_VARIABLE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function sensitiveVariablePatterns(): readonly string[] {
    return SENSITIVE_VARIABLE_PATTERNS;
}
