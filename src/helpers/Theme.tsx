import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";

const THEME_STORAGE_KEY = "bifrost.theme";
const SYSTEM_COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
    theme: Theme;
    resolvedTheme: ResolvedTheme;
    setTheme: (nextTheme: Theme) => void;
    toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTheme(value: unknown): value is Theme {
    return value === "light" || value === "dark" || value === "system";
}

function readStoredTheme(): Theme {
    if (typeof window === "undefined") {
        return "system";
    }

    try {
        const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
        return isTheme(raw) ? raw : "system";
    } catch {
        return "system";
    }
}

function getSystemPrefersDark(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return true;
    }
    return window.matchMedia(SYSTEM_COLOR_SCHEME_QUERY).matches;
}

function resolveTheme(theme: Theme, systemPrefersDark: boolean): ResolvedTheme {
    if (theme === "system") {
        return systemPrefersDark ? "dark" : "light";
    }
    return theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
    const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
        getSystemPrefersDark()
    );

    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
            return;
        }

        const mediaQuery = window.matchMedia(SYSTEM_COLOR_SCHEME_QUERY);
        const updateSystemTheme = (event: MediaQueryListEvent) => {
            setSystemPrefersDark(event.matches);
        };

        setSystemPrefersDark(mediaQuery.matches);
        if (typeof mediaQuery.addEventListener === "function") {
            mediaQuery.addEventListener("change", updateSystemTheme);
        } else {
            mediaQuery.addListener(updateSystemTheme);
        }

        return () => {
            if (typeof mediaQuery.removeEventListener === "function") {
                mediaQuery.removeEventListener("change", updateSystemTheme);
            } else {
                mediaQuery.removeListener(updateSystemTheme);
            }
        };
    }, []);

    const resolvedTheme = useMemo<ResolvedTheme>(
        () => resolveTheme(theme, systemPrefersDark),
        [theme, systemPrefersDark]
    );

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch {
            // ignore storage write failures
        }
    }, [theme]);

    useEffect(() => {
        if (typeof document === "undefined") return;
        const root = document.documentElement;
        root.setAttribute("data-theme", resolvedTheme);
        root.setAttribute("data-theme-preference", theme);
        root.style.colorScheme = resolvedTheme;
    }, [resolvedTheme, theme]);

    const toggleTheme = useCallback(() => {
        setTheme((currentTheme) =>
            resolveTheme(currentTheme, systemPrefersDark) === "dark" ? "light" : "dark"
        );
    }, [systemPrefersDark]);

    const contextValue = useMemo<ThemeContextValue>(
        () => ({
            theme,
            resolvedTheme,
            setTheme,
            toggleTheme,
        }),
        [theme, resolvedTheme, toggleTheme]
    );

    return (
        <ThemeContext.Provider value={contextValue}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme(): ThemeContextValue {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error("useTheme must be used within ThemeProvider");
    }
    return context;
}
