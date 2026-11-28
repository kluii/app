// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import { t } from '../../i18n';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Field } from '../ui/field';
import { Input } from '../ui/input';

/**
 * Account deletion with explicit password + confirmation (K5-08, docs/security.md §9).
 */
export function DangerSettings() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => api.deleteAccount({ password, confirm: true }),
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: '/login' });
    },
    onError: (cause) => setError(failureMessage(cause)),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed || password === '') return;
    remove.mutate();
  };

  return (
    <section className="flex max-w-140 flex-col gap-4">
      {/* The danger rule, not a red block: a 2 px --danger left rule, title
          and body in --danger, no background (landing §7, brief §4.5). */}
      <div className="flex flex-col gap-1 border-l-2 border-danger pl-4">
        <h2 className="font-display text-h2 text-danger">{t('settings.danger.title')}</h2>
        <p className="text-body-sm text-danger">{t('settings.danger.description')}</p>
        {error ? (
          <p className="text-body-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-sm border border-border p-4">
        <Field label={t('settings.danger.password')} htmlFor="delete-account-password">
          <Input
            id="delete-account-password"
            type="password"
            autoComplete="current-password"
            value={password}
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Checkbox
          id="delete-account-confirm"
          label={t('settings.danger.confirmLabel')}
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <div>
          <Button
            type="submit"
            variant="danger"
            loading={remove.isPending}
            disabled={!confirmed || password === ''}
          >
            {t('settings.danger.action')}
          </Button>
        </div>
      </form>
    </section>
  );
}
