// SPDX-License-Identifier: AGPL-3.0-only
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { AuthPage } from '../components/auth/auth-page';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { t } from '../i18n';
import { queryClient, queryKeys } from '../lib/query-client';
import { rootRoute } from './root';

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await api.login({ email_or_username: identifier, password });
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      await navigate({ to: '/boards' });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setError(t('auth.signIn.error.invalid'));
      } else {
        setError(t('common.error.generic'));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthPage>
      <h1 className="text-display">{t('auth.signIn.title')}</h1>
      <p className="mt-2 text-body-sm text-ink-muted">{t('auth.signIn.subtitle')}</p>

      <form className="mt-8 flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <Field label={t('auth.signIn.emailOrUsername')} htmlFor="identifier">
          <Input
            id="identifier"
            name="email_or_username"
            autoComplete="username"
            autoFocus
            required
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </Field>
        <Field label={t('auth.signIn.password')} htmlFor="password" error={error}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-2 w-full">
          {t('auth.signIn.submit')}
        </Button>
      </form>

      <p className="mt-6 text-center text-body-sm text-ink-muted">
        <Link to="/signup" className="text-ink underline-offset-4 hover:underline">
          {t('auth.signIn.toSignUp')}
        </Link>
      </p>
    </AuthPage>
  );
}
