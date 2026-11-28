// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One identity, one control. The bar used to carry a theme toggle, an "Account"
 * link, the raw username and a logout icon — four controls for one person. The
 * avatar opens all of it: who you are, the theme, and the way out. The language
 * lives in Settings (it is a choice you make once, not a toggle), and the header
 * states the three facts that identify the account: the name, the handle, the
 * address.
 */
import { useNavigate } from '@tanstack/react-router';
import { Moon, Sun, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api/client';
import type { Me } from '../../api/types';
import { t } from '../../i18n';
import { minidenticon } from '../../lib/identicon';
import { useTheme, type Theme } from '../../lib/theme';
import { atUsername } from '../../lib/username';
import {
  DropdownCheckItem,
  DropdownGroup,
  DropdownHeader,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
} from '../ui/dropdown-menu';

/** The icon each theme wears in the menu: the target, not the current state. */
const THEMES: { id: Theme; icon: LucideIcon }[] = [
  { id: 'light', icon: Sun },
  { id: 'dark', icon: Moon },
];

export function AccountMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

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
          title={me.display_name ?? atUsername(me.username)}
          data-testid="account-avatar"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-strong transition-colors duration-[var(--dur-fast)] hover:border-ink-subtle"
        >
          {/* Grey: saturation 0, so no hue leaves the palette. The identicon's
              own defaults are untouched; only this call turns the hue off. */}
          <span
            aria-hidden="true"
            className="block h-full w-full"
            dangerouslySetInnerHTML={{ __html: minidenticon(me.username, 0, 50) }}
          />
        </button>
      )}
    >
      <DropdownHeader>
        {/* Three lines when the account has a name, two when it does not: the
            handle used to stand in for the missing name and then say itself
            again. The handle always carries its at sign. */}
        {me.display_name === null ? null : (
          <span className="truncate text-label text-ink">{me.display_name}</span>
        )}
        <span className="truncate font-mono text-mono-sm text-ink-subtle">
          {atUsername(me.username)}
        </span>
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
        {THEMES.map((value) => {
          const Icon = value.icon;
          return (
            <DropdownCheckItem
              key={value.id}
              checked={theme === value.id}
              icon={<Icon aria-hidden className="h-4 w-4" strokeWidth={1.5} />}
              onSelect={() => {
                setTheme(value.id);
                setOpen(false);
              }}
            >
              {t(`theme.${value.id}`)}
            </DropdownCheckItem>
          );
        })}
      </DropdownGroup>
      <DropdownSeparator />
      <DropdownItem tone="danger" onSelect={() => void signOut()}>
        {t('common.action.signOut')}
      </DropdownItem>
    </DropdownMenu>
  );
}
