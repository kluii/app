// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One identity, one control. The bar used to carry a theme toggle, an "Account"
 * link, the raw username and a logout icon — four controls for one person. The
 * avatar opens all of it: who you are, the theme, the language, and the way out.
 */
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../../api/client';
import type { Me } from '../../api/types';
import { getLocale, setLocale, t } from '../../i18n';
import { minidenticon } from '../../lib/identicon';
import { useTheme, type Theme } from '../../lib/theme';
import {
  DropdownCheckItem,
  DropdownGroup,
  DropdownHeader,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
} from '../ui/dropdown-menu';

const THEMES: Theme[] = ['light', 'dark'];
const LOCALES = [
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
] as const;

export function AccountMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const locale = getLocale();
  // The avatar is grey: saturation 0, lightness 50, so no hue leaves the
  // palette. The identicon's own defaults are untouched (DESIGN.md §10).

  const signOut = async (): Promise<void> => {
    setOpen(false);
    await api.logout();
    await navigate({ to: '/login' });
  };

  return (
    <DropdownMenu
      label={t('nav.account')}
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={(wiring) => (
        <button
          type="button"
          {...wiring}
          aria-label={t('nav.account')}
          title={me.display_name ?? me.username}
          data-testid="account-avatar"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-strong transition-colors duration-[var(--dur-fast)] hover:border-ink-subtle"
        >
          <span
            aria-hidden="true"
            className="block h-full w-full"
            dangerouslySetInnerHTML={{ __html: minidenticon(me.username, 0, 50) }}
          />
        </button>
      )}
    >
      <DropdownHeader>
        <span className="truncate text-label text-ink">{me.display_name ?? me.username}</span>
        <span className="truncate font-mono text-mono-sm text-ink-subtle">{me.email}</span>
      </DropdownHeader>
      <DropdownItem
        onSelect={() => {
          setOpen(false);
          void navigate({ to: '/settings' });
        }}
      >
        {t('account.settings')}
      </DropdownItem>
      <DropdownSeparator />
      <DropdownGroup label={t('account.theme')}>
        {THEMES.map((value) => (
          <DropdownCheckItem
            key={value}
            checked={theme === value}
            onSelect={() => {
              setTheme(value);
              setOpen(false);
            }}
          >
            {t(`theme.${value}`)}
          </DropdownCheckItem>
        ))}
      </DropdownGroup>
      <DropdownGroup label={t('account.language')}>
        {LOCALES.map((value) => (
          <DropdownCheckItem
            key={value.id}
            checked={locale === value.id}
            onSelect={() => {
              setLocale(value.id);
              setOpen(false);
            }}
          >
            {value.label}
          </DropdownCheckItem>
        ))}
      </DropdownGroup>
      <DropdownSeparator />
      <DropdownItem tone="danger" onSelect={() => void signOut()}>
        {t('common.action.signOut')}
      </DropdownItem>
    </DropdownMenu>
  );
}
