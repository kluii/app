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

type Factor = { kind: 'totp'; value: string } | { kind: 'recovery'; value: string } | null;

function LoginPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [factor, setFactor] = useState<Factor>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await api.login({
        email_or_username: identifier,
        password,
        ...(factor?.value
          ? factor.kind === 'totp'
            ? { totp: factor.value }
            : { recovery_code: factor.value }
          : {}),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      await navigate({ to: '/boards' });
    } catch (caught) {
      // The password was right and the factor is missing: ask for it, and keep
      // the password in the form so the second submit is one field.
      if (caught instanceof ApiError && caught.code === 'totp_required') {
        setFactor((current) => current ?? { kind: 'totp', value: '' });
        setError(null);
      } else if (caught instanceof ApiError && caught.code === 'invalid_code') {
        setError(t('auth.signIn.error.invalidCode'));
      } else if (caught instanceof ApiError && caught.status === 401) {
        setFactor(null);
        setError(t('auth.signIn.error.invalid'));
      } else {
        setError(t('common.error.generic'));
      }
    } finally {
      setPending(false);
    }
  };

  const needsFactor = factor !== null;

  return (
    <AuthPage>
      <h1 className="font-display text-display">{t('auth.signIn.title')}</h1>
      <p className="mt-2 text-body-sm text-ink-muted">{t('auth.signIn.subtitle')}</p>

      <form className="mt-8 flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <Field label={t('auth.signIn.emailOrUsername')} htmlFor="identifier">
          <Input
            id="identifier"
            name="email_or_username"
            autoComplete="username"
            autoFocus={!needsFactor}
            required
            readOnly={needsFactor}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </Field>
        <Field
          label={t('auth.signIn.password')}
          htmlFor="password"
          error={needsFactor ? null : error}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            readOnly={needsFactor}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        {needsFactor ? (
          <Field
            label={useRecovery ? t('auth.signIn.recoveryCode') : t('auth.signIn.totp')}
            htmlFor="factor"
            hint={useRecovery ? undefined : t('auth.signIn.totpHint')}
            error={error}
          >
            <Input
              id="factor"
              name="factor"
              autoFocus
              autoComplete="one-time-code"
              inputMode={useRecovery ? 'text' : 'numeric'}
              maxLength={useRecovery ? 32 : 6}
              required
              value={factor?.value ?? ''}
              onChange={(event) =>
                setFactor({
                  kind: useRecovery ? 'recovery' : 'totp',
                  value: event.target.value.trim(),
                })
              }
            />
          </Field>
        ) : null}

        <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-2 w-full">
          {t('auth.signIn.submit')}
        </Button>
      </form>

      {needsFactor ? (
        <p className="mt-4 text-center text-body-sm">
          <button
            type="button"
            className="text-ink-muted underline-offset-4 hover:text-ink hover:underline"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setFactor({ kind: useRecovery ? 'totp' : 'recovery', value: '' });
              setError(null);
            }}
          >
            {useRecovery ? t('auth.signIn.useTotp') : t('auth.signIn.useRecovery')}
          </button>
        </p>
      ) : (
        <>
          <p className="mt-6 text-center text-body-sm text-ink-muted">
            <Link to="/signup" className="text-ink underline-offset-4 hover:underline">
              {t('auth.signIn.toSignUp')}
            </Link>
          </p>
          <p className="mt-2 text-center text-body-sm">
            <Link
              to="/reset"
              className="text-ink-subtle underline-offset-4 hover:text-ink hover:underline"
            >
              {t('auth.signIn.forgot')}
            </Link>
          </p>
        </>
      )}
    </AuthPage>
  );
}
