import React from "react";

const STORAGE_KEY = "cca.a11yMode";

interface A11yContextValue {
  a11yMode: boolean;
  toggleA11yMode: () => void;
}

export const A11yContext = React.createContext<A11yContextValue | null>(null);

export function A11yProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [a11yMode, setA11yMode] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggleA11yMode = React.useCallback(() => {
    setA11yMode(prev => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage unavailable (e.g. private browsing restrictions) — no-op
      }
      return next;
    });
  }, []);

  return React.createElement(
    A11yContext.Provider,
    { value: { a11yMode, toggleA11yMode } },
    children,
  );
}

export function useA11yMode(): A11yContextValue {
  const ctx = React.useContext(A11yContext);
  if (!ctx) {
    throw new Error("useA11yMode must be used within A11yProvider");
  }
  return ctx;
}
