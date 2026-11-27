// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'klui-theme';

const LISTENERS = new Set<() => void>();

export function currentTheme(): Theme {
  const value = document.documentElement.getAttribute('data-theme');
  return value === 'light' ? 'light' : 'dark';
}

/** Persist the choice; the inline bootstrap in index.html reads it before paint. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // a blocked storage must not break the toggle
  }
  for (const listener of LISTENERS) listener();
}

/** `useSyncExternalStore` contract: a stable value per theme, and a way to hear about it. */
function subscribe(listener: () => void): () => void {
  LISTENERS.add(listener);
  return () => {
    LISTENERS.delete(listener);
  };
}

/**
 * The document attribute is the store, not a copy of it: a switch anywhere in
 * the UI re-renders every consumer, so the wordmark cannot outlive the theme it
 * was chosen for.
 */
export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (next: Theme) => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'dark' as Theme);
  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
  }, []);
  const toggle = useCallback(() => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }, []);
  return { theme, setTheme, toggle };
}
