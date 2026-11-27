// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import { Chip } from '../ui/chip';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';

type Enrollment = { secret: string; otpauth_url: string; recovery_codes: string[] };

/**
 * Two-factor authentication (K1-04). The secret and the recovery codes are
 * rendered once, from the response that created them: no endpoint reads them
 * back, so a reload cannot reveal them again.
 */
export function SecuritySettings() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me, retry: false });
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
  };

  const startEnrollment = useMutation({
    mutationFn: api.enrollTotp,
    onSuccess: (result) => {
      setEnrollment(result);
      setError(null);
    },
    onError: (cause) => setError(failureMessage(cause)),
  });

  const confirm = useMutation({
    mutationFn: () => api.verifyTotp(code.trim()),
    onSuccess: async () => {
      setEnrollment(null);
      setCode('');
      await refresh();
    },
    onError: (caught) => setError(messageFor(caught)),
  });

  const disable = useMutation({
    mutationFn: () => api.disableTotp({ password, code: code.trim() }),
    onSuccess: async () => {
      setPassword('');
      setCode('');
      setError(null);
      await refresh();
    },
    onError: (caught) => setError(messageFor(caught)),
  });

  const regenerate = useMutation({
    mutationFn: () => api.regenerateRecoveryCodes(password),
    onSuccess: (result) => {
      setCodes(result.recovery_codes);
      setPassword('');
      setError(null);
    },
    onError: (caught) => setError(messageFor(caught)),
  });

  const enabled = me.data?.totp_enabled ?? false;

  return (
    <section className="flex max-w-140 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-h2">{t('settings.security.title')}</h2>
        <Chip>
          {enabled ? t('settings.security.status.on') : t('settings.security.status.off')}
        </Chip>
      </div>
      <p className="text-body-sm text-ink-muted">{t('settings.security.description')}</p>

      {error ? (
        <p className="text-body-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {codes ? (
        <CodeList
          title={t('settings.security.codesTitle')}
          hint={t('settings.security.codesHint')}
          codes={codes}
        />
      ) : null}

      {enabled ? (
        <div className="flex flex-col gap-4 rounded-md border border-border p-4">
          <Field label={t('settings.security.password')} htmlFor="disable-password">
            <Input
              id="disable-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label={t('settings.security.code')} htmlFor="disable-code">
            <Input
              id="disable-code"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.trim())}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={disable.isPending}
              disabled={password === '' || code.length !== 6}
              onClick={() => disable.mutate()}
            >
              {t('settings.security.disable')}
            </Button>
            <Button
              variant="ghost"
              loading={regenerate.isPending}
              disabled={password === ''}
              onClick={() => regenerate.mutate()}
              title={t('settings.security.regenerateHint')}
            >
              {t('settings.security.regenerate')}
            </Button>
          </div>
        </div>
      ) : enrollment ? (
        <div className="flex flex-col gap-4 rounded-md border border-border p-4">
          <p className="text-body-sm text-ink-muted">{t('settings.security.enrollHint')}</p>
          <div className="flex flex-col gap-1">
            <span className="text-label font-medium text-ink-muted">
              {t('settings.security.secret')}
            </span>
            <code className="break-all rounded-sm bg-surface-2 px-2 py-1.5 font-mono text-mono">
              {enrollment.secret}
            </code>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-label font-medium text-ink-muted">
              {t('settings.security.uri')}
            </span>
            <code className="break-all rounded-sm bg-surface-2 px-2 py-1.5 font-mono text-mono">
              {enrollment.otpauth_url}
            </code>
          </div>
          <CodeList
            title={t('settings.security.codesTitle')}
            hint={t('settings.security.codesHint')}
            codes={enrollment.recovery_codes}
          />
          <div className="flex items-end gap-2">
            <Field label={t('settings.security.code')} htmlFor="confirm-code" className="flex-1">
              <Input
                id="confirm-code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.trim())}
              />
            </Field>
            <Button
              variant="primary"
              loading={confirm.isPending}
              disabled={code.length !== 6}
              onClick={() => confirm.mutate()}
            >
              {t('settings.security.confirm')}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            variant="secondary"
            loading={startEnrollment.isPending}
            onClick={() => startEnrollment.mutate()}
          >
            {t('settings.security.enroll')}
          </Button>
        </div>
      )}
    </section>
  );
}

function CodeList({ title, hint, codes }: { title: string; hint: string; codes: string[] }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-2 p-3">
      <span className="text-label font-medium text-ink-muted">{title}</span>
      <ul className="grid grid-cols-2 gap-1 font-mono text-mono text-ink">
        {codes.map((code) => (
          <li key={code} data-testid="recovery-code">
            {code}
          </li>
        ))}
      </ul>
      <p className="text-body-sm text-ink-subtle">{hint}</p>
    </div>
  );
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError && error.code === 'invalid_code') {
    return t('auth.signIn.error.invalidCode');
  }
  return failureMessage(error);
}
