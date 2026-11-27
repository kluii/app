// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'klui-theme';

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
}

export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (next: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(currentTheme);
  useEffect(() => {
    setThemeState(currentTheme());
  }, []);
  return {
    theme,
    setTheme: (next: Theme) => {
      applyTheme(next);
      setThemeState(next);
    },
    toggle: () => {
      const next: Theme = theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      setThemeState(next);
    },
  };
}
