// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { useTheme } from '../../lib/theme';
import { t } from '../../i18n';
import lightLogo from '../../assets/light-logo.png';
import darkLogo from '../../assets/dark-logo.png';

/** Auth cards are the only centred content in the app (DESIGN.md §4). */
export function AuthPage({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-95">
          <div className="flex items-center justify-between">
            <img
              src={theme === 'dark' ? lightLogo : darkLogo}
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
          </div>
          <div className="mt-10">{children}</div>
        </div>
      </div>
      <footer className="px-4 py-3 text-center">
        <a
          href="https://wyliam.dev"
          target="_blank"
          rel="noreferrer noopener"
          className="text-body-sm text-ink-subtle underline-offset-4 hover:text-ink-muted hover:underline"
        >
          {t('common.footer.madeBy')}
        </a>
      </footer>
    </div>
  );
}
