// SPDX-License-Identifier: AGPL-3.0-only
import { Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { useTheme } from '../../lib/theme';
import whiteLogo from '../../assets/klui-logo-white.png';
import blackLogo from '../../assets/klui-logo-black.png';
import { Button } from '../ui/button';

/**
 * Auth is a page, not a form floating in a void (brief §4.6): a 56 px top row
 * carrying the wordmark and one 32 px theme button, the form 360 wide under it
 * on a phone, and from 1024 px the form on the left with the plate's column
 * beside it — empty for now, filled in phase 8.
 *
 * The theme control is an icon, not the word `Dark`: it names what the button
 * does, not the state it leaves you in.
 */
export function AuthPage({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <div className="flex h-14 items-center justify-between px-6">
        <img
          src={theme === 'dark' ? whiteLogo : blackLogo}
          alt={t('common.app.name')}
          className="h-6 w-auto"
        />
        <Button variant="ghost" size="icon" onClick={toggle} aria-label={t('theme.toggle')}>
          {theme === 'dark' ? (
            <Sun aria-hidden="true" size={16} strokeWidth={1.5} />
          ) : (
            <Moon aria-hidden="true" size={16} strokeWidth={1.5} />
          )}
        </Button>
      </div>

      {/* Under 1024 px: one column, not vertically centred — a page that starts
          at a fixed 64 below the top row, rather than one that jumps when an
          error message changes the form's height. */}
      <div className="mt-16 grid flex-1 grid-cols-1 gap-6 px-6 pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <main
          id="main-content"
          tabIndex={-1}
          className="w-full max-w-90 justify-self-center focus:outline-none lg:flex lg:flex-col lg:justify-center"
        >
          {children}
        </main>
        <div aria-hidden="true" className="hidden lg:block" />
      </div>
    </div>
  );
}
