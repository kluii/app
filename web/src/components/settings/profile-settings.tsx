// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Moon, Sun, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import { queryKeys } from '../../lib/query-client';
import { cn } from '../../lib/cn';
import { useTheme, type Theme } from '../../lib/theme';
import { getLocale, setLocale, t, type Locale } from '../../i18n';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';

const THEMES: { id: Theme; icon: LucideIcon }[] = [
  { id: 'light', icon: Sun },
  { id: 'dark', icon: Moon },
];

/**
 * An endonym names its own language, so both catalogues carry the same word:
 * `English` is `English` to a French reader. The key still goes through `t()`.
 */
const LOCALES: { id: Locale; label: string }[] = [
  { id: 'en', label: 'settings.interface.english' },
  { id: 'fr', label: 'settings.interface.french' },
];

/** The selected half of a two-way control: the active row, not a pressed pill. */
const SELECTED = 'bg-surface-muted text-ink shadow-[var(--shadow-active)]';

/**
 * Profile edit, interface choices and password change (K5-08, D-13, D-16).
 *
 * The theme and the language are one choice each, made once and remembered by
 * the browser: two icon buttons and two words, never a native select, and no
 * third option that would mean "follow the system" without saying so.
 */
export function ProfileSettings() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me, retry: false });
  const { theme, setTheme } = useTheme();
  // A language change remounts the tree (App.tsx), so reading it is enough.
  const locale = getLocale();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    if (!me.data) return;
    setUsername(me.data.username);
    setDisplayName(me.data.display_name ?? '');
    setEmail(me.data.email);
  }, [me.data]);

  const saveProfile = useMutation({
    mutationFn: api.updateProfile,
    onSuccess: async () => {
      setProfileError(null);
      setProfileSaved(true);
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
    onError: (cause) => {
      setProfileSaved(false);
      setProfileError(failureMessage(cause));
    },
  });

  const savePassword = useMutation({
    mutationFn: api.changePassword,
    onSuccess: async () => {
      setCurrentPassword('');
      setNewPassword('');
      setPasswordError(null);
      setPasswordSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (cause) => {
      setPasswordSaved(false);
      setPasswordError(failureMessage(cause));
    },
  });

  const onProfileSubmit = (event: FormEvent) => {
    event.preventDefault();
    saveProfile.mutate({
      username: username.trim().toLowerCase(),
      display_name: displayName.trim() === '' ? null : displayName.trim(),
      email: email.trim().toLowerCase(),
    });
  };

  const onPasswordSubmit = (event: FormEvent) => {
    event.preventDefault();
    savePassword.mutate({ current_password: currentPassword, new_password: newPassword });
  };

  return (
    <section className="flex max-w-140 flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-h2">{t('settings.profile.title')}</h2>
        <p className="text-body-sm text-ink-muted">{t('settings.profile.description')}</p>

        {profileError ? (
          <p className="text-body-sm text-danger" role="alert">
            {profileError}
          </p>
        ) : null}
        {profileSaved ? (
          <p className="text-body-sm text-ink-muted" role="status">
            {t('settings.profile.saved')}
          </p>
        ) : null}

        <form
          onSubmit={onProfileSubmit}
          className="flex flex-col gap-4 rounded-sm border border-border p-4"
        >
          <Field label={t('settings.profile.username')} htmlFor="profile-username">
            <Input
              id="profile-username"
              value={username}
              minLength={3}
              maxLength={32}
              required
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field label={t('settings.profile.displayName')} htmlFor="profile-display-name">
            <Input
              id="profile-display-name"
              value={displayName}
              maxLength={64}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field label={t('settings.profile.email')} htmlFor="profile-email">
            <Input
              id="profile-email"
              type="email"
              value={email}
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" variant="primary" loading={saveProfile.isPending}>
              {t('settings.profile.save')}
            </Button>
          </div>
        </form>
      </div>

      <div className="flex flex-col gap-4 border-t border-border pt-8">
        <h3 className="text-h3">{t('settings.interface.title')}</h3>
        <p className="text-body-sm text-ink-muted">{t('settings.interface.hint')}</p>

        <div className="flex flex-wrap gap-8 rounded-sm border border-border p-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-label font-medium text-ink-muted">
              {t('settings.interface.theme')}
            </legend>
            <div className="flex gap-2">
              {THEMES.map((value) => {
                const Icon = value.icon;
                const selected = theme === value.id;
                return (
                  <Button
                    key={value.id}
                    size="icon"
                    variant="ghost"
                    aria-pressed={selected}
                    aria-label={t(`theme.${value.id}`)}
                    className={cn(selected && SELECTED)}
                    onClick={() => setTheme(value.id)}
                  >
                    <Icon aria-hidden className="h-4 w-4" strokeWidth={1.5} />
                  </Button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-label font-medium text-ink-muted">
              {t('settings.interface.language')}
            </legend>
            <div className="flex gap-2">
              {LOCALES.map((value) => {
                const selected = locale === value.id;
                return (
                  <Button
                    key={value.id}
                    variant="ghost"
                    aria-pressed={selected}
                    className={cn(selected && SELECTED)}
                    onClick={() => setLocale(value.id)}
                  >
                    {t(value.label)}
                  </Button>
                );
              })}
            </div>
          </fieldset>
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-border pt-8">
        <h3 className="text-h3">{t('settings.password.title')}</h3>
        <p className="text-body-sm text-ink-muted">{t('settings.password.description')}</p>

        {passwordError ? (
          <p className="text-body-sm text-danger" role="alert">
            {passwordError}
          </p>
        ) : null}
        {passwordSaved ? (
          <p className="text-body-sm text-ink-muted" role="status">
            {t('settings.password.saved')}
          </p>
        ) : null}

        <form
          onSubmit={onPasswordSubmit}
          className="flex flex-col gap-4 rounded-sm border border-border p-4"
        >
          <Field label={t('settings.password.current')} htmlFor="current-password">
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              required
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>
          <Field label={t('settings.password.next')} htmlFor="new-password">
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              minLength={12}
              required
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          <div>
            <Button
              type="submit"
              variant="secondary"
              loading={savePassword.isPending}
              disabled={currentPassword === '' || newPassword.length < 12}
            >
              {t('settings.password.save')}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
