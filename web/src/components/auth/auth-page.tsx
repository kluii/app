// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { useTheme } from '../../lib/theme';
import { t } from '../../i18n';
import whiteLogo from '../../assets/klui-logo-white.png';
import blackLogo from '../../assets/klui-logo-black.png';

/** Auth cards are the only centred content in the app (DESIGN.md §4). */
export function AuthPage({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-95">
          <header className="flex items-center justify-between">
            <img
              src={theme === 'dark' ? whiteLogo : blackLogo}
              alt={t('common.app.name')}
              className="h-8 w-auto"
            />
            <button
              type="button"
              onClick={toggle}
              className="text-label text-ink-subtle underline-offset-4 hover:text-ink hover:underline"
            >
              {theme === 'dark' ? t('theme.light') : t('theme.dark')}
            </button>
          </header>
          <main id="main-content" tabIndex={-1} className="mt-10 focus:outline-none">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
