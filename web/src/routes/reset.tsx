// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { AuthPage } from '../components/auth/auth-page';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { t } from '../i18n';
import { rootRoute } from './root';

type ResetSearch = { token?: string };

export const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset',
  validateSearch: (search: Record<string, unknown>): ResetSearch =>
    typeof search.token === 'string' ? { token: search.token } : {},
  component: ResetPage,
});

function ResetPage() {
  const { token } = resetRoute.useSearch();
  return <AuthPage>{token ? <ConfirmForm token={token} /> : <RequestForm />}</AuthPage>;
}

function RequestForm() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useMutation({
    mutationFn: () => api.requestPasswordReset(email.trim()),
    onSuccess: () => {
      setMessage(t('auth.reset.sent'));
      setError(null);
    },
    onError: (caught) => {
      setError(
        caught instanceof ApiError && caught.code === 'email_not_configured'
          ? t('auth.reset.unavailable')
          : t('common.error.generic'),
      );
    },
  });

  return (
    <>
      <h1 className="font-display text-h1">{t('auth.reset.title')}</h1>
      <p className="mt-2 text-body-sm text-ink-muted">{t('auth.reset.requestBody')}</p>

      <form
        className="mt-8 flex flex-col gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (!request.isPending) request.mutate();
        }}
      >
        <Field label={t('auth.signUp.email')} htmlFor="reset-email" error={error}>
          <Input
            id="reset-email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" loading={request.isPending} className="h-10 w-full">
          {t('auth.reset.submit')}
        </Button>
      </form>

      {message ? (
        <p className="mt-4 text-body-sm text-ink-muted" role="status">
          {message}
        </p>
      ) : null}

      <p className="mt-6 text-center text-body-sm text-ink-muted">
        <Link to="/login" className="text-ink underline underline-offset-4">
          {t('auth.reset.toSignIn')}
        </Link>
      </p>
    </>
  );
}

function ConfirmForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = useMutation({
    mutationFn: () => api.confirmPasswordReset({ token, password }),
    onSuccess: () => setDone(true),
    onError: (caught) =>
      setError(
        caught instanceof ApiError && caught.code === 'invalid_code'
          ? t('auth.reset.invalidLink')
          : t('common.error.generic'),
      ),
  });

  return (
    <>
      <h1 className="font-display text-h1">{t('auth.reset.confirmTitle')}</h1>
      <p className="mt-2 text-body-sm text-ink-muted">{t('auth.reset.confirmBody')}</p>

      {done ? (
        <div className="mt-8 flex flex-col gap-4">
          <p className="text-body-sm text-ink-muted" role="status">
            {t('auth.reset.done')}
          </p>
          <Link to="/login" className="text-body-sm text-ink underline underline-offset-4">
            {t('auth.reset.toSignIn')}
          </Link>
        </div>
      ) : (
        <form
          className="mt-8 flex flex-col gap-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (!confirm.isPending) confirm.mutate();
          }}
        >
          <Field label={t('auth.reset.newPassword')} htmlFor="reset-password" error={error}>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={256}
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={confirm.isPending}
            className="h-10 w-full"
          >
            {t('auth.reset.confirm')}
          </Button>
        </form>
      )}
    </>
  );
}
