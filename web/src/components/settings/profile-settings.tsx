// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import { queryKeys } from '../../lib/query-client';
import { t } from '../../i18n';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';

/**
 * Profile edit and password change (K5-08, D-13, D-16).
 */
export function ProfileSettings() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me, retry: false });

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
          className="flex flex-col gap-4 rounded-md border border-border p-4"
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
          className="flex flex-col gap-4 rounded-md border border-border p-4"
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
