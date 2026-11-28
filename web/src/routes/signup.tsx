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
import { RESERVED_MESSAGE, checkUsername } from '../lib/validation';
import { rootRoute } from './root';

export const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await api.signup({ email, username, password });
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      await navigate({ to: '/boards' });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'conflict') {
        setError(t('auth.signUp.error.conflict'));
      } else if (
        caught instanceof ApiError &&
        caught.details?.some((detail) => detail.message === RESERVED_MESSAGE)
      ) {
        // The same answer a taken name gets: which names the instance keeps for
        // itself is not something a stranger has to be able to enumerate.
        setError(t('auth.signUp.error.conflict'));
      } else if (caught instanceof ApiError && caught.code === 'validation_failed') {
        setError(t('auth.signUp.error.weak'));
      } else {
        setError(t('common.error.generic'));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthPage>
      <h1 className="font-display text-h1">{t('auth.signUp.title')}</h1>
      <p className="mt-2 text-body-sm text-ink-muted">{t('auth.signUp.subtitle')}</p>

      <form className="mt-8 flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <Field label={t('auth.signUp.email')} htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field
          label={t('auth.signUp.username')}
          htmlFor="username"
          hint={t('auth.signUp.usernameHint')}
          error={checkUsername(username) === 'reserved' ? t('auth.signUp.error.conflict') : null}
        >
          <Input
            id="username"
            autoComplete="username"
            required
            minLength={3}
            maxLength={32}
            pattern="[a-z0-9][a-z0-9\-]{1,30}[a-z0-9]"
            value={username}
            onChange={(event) => setUsername(event.target.value.toLowerCase())}
          />
        </Field>
        <Field
          label={t('auth.signUp.password')}
          htmlFor="password"
          hint={t('auth.signUp.passwordHint')}
          error={error}
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={256}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-2 w-full">
          {t('auth.signUp.submit')}
        </Button>
      </form>

      <p className="mt-6 text-center text-body-sm text-ink-muted">
        <Link to="/login" className="text-ink underline-offset-4 hover:underline">
          {t('auth.signUp.toSignIn')}
        </Link>
      </p>
    </AuthPage>
  );
}
