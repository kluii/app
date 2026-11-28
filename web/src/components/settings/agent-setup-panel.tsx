// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Client setup (K4-07, docs/mcp.md §7). One block per client, built from one
 * template with two variables: the instance base URL and the key. The four
 * first-class clients share a URL and an `Authorization: Bearer` header; only
 * the shape of the block differs. OpenCode, Pi and Hermes get a prompt, because
 * they have no config block to paste.
 *
 * "Test connection" asks the server (`POST /agent-keys/:id/test`) what the key
 * actually reaches and renders that answer verbatim: a board name and a role,
 * or the refusal reason. Nothing here decides a permission and nothing here
 * says "looks good".
 */
import { useMutation } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api/client';
import type { AgentKey, AgentKeyRefusal, AgentKeyTest } from '../../api/types';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Select } from '../ui/input';
import { useToast } from '../ui/toast';

type CopyBlock = {
  id: string;
  name: string;
  hint?: string;
  value: string;
  testId: string;
  /** Long prose gets a capped frame so three of them do not swallow the page. */
  capped?: boolean;
};

export function AgentSetupPanel({
  fresh,
  keys,
}: {
  /** The key returned by the create call, while its panel is open. */
  fresh: { id: string; key: string } | null;
  keys: AgentKey[];
}) {
  const { notify } = useToast();
  const [targetId, setTargetId] = useState('');
  const [clientId, setClientId] = useState('claude');
  const [skillId, setSkillId] = useState('opencode');
  const [error, setError] = useState<string | null>(null);

  const url = `${window.location.origin}/mcp`;
  const placeholder = t('settings.agents.keyPlaceholder');
  const keyValue = fresh?.key ?? placeholder;

  // Every listed key is testable, including dead ones: testing a revoked or
  // expired key answers with that reason, which is the point of the button.
  const chosen = keys.some((key) => key.id === targetId) ? targetId : (keys[0]?.id ?? '');
  const target = fresh?.id ?? chosen;

  const test = useMutation({
    // With the fresh key the server compares hashes; without it, it probes the
    // stored row. Both answers come from `can()`, not from this component.
    mutationFn: () => api.testAgentKey(target, fresh?.key),
    onSuccess: () => setError(null),
    onError: () => setError(t('settings.agents.test.failed')),
  });

  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      notify(t('settings.agents.copied'));
    } catch {
      notify(t('settings.agents.copyFailed'), 'danger');
    }
  };

  const clients: CopyBlock[] = [
    {
      id: 'claude',
      name: t('settings.agents.client.claude'),
      hint: t('settings.agents.client.claudeHint'),
      value: t('settings.agents.client.claudeBlock', { url, key: keyValue }),
      testId: 'copy-claude',
    },
    {
      id: 'chatgpt',
      name: t('settings.agents.client.chatgpt'),
      hint: t('settings.agents.client.chatgptHint'),
      value: t('settings.agents.client.block', { url, key: keyValue }),
      testId: 'copy-chatgpt',
    },
    {
      id: 'mistral',
      name: t('settings.agents.client.mistral'),
      hint: t('settings.agents.client.mistralHint'),
      value: t('settings.agents.client.block', { url, key: keyValue }),
      testId: 'copy-mistral',
    },
    {
      id: 'gemini',
      name: t('settings.agents.client.gemini'),
      hint: t('settings.agents.client.geminiHint'),
      value: t('settings.agents.client.block', { url, key: keyValue }),
      testId: 'copy-gemini',
    },
  ];

  const skills: CopyBlock[] = ['opencode', 'pi', 'hermes'].map((id) => ({
    id,
    name: t(`settings.agents.skill.${id}`),
    value: t('settings.agents.skill.block', { url, key: keyValue }),
    testId: `copy-skill-${id}`,
    capped: true,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-h3">{t('settings.agents.setup.title')}</h3>
        <p className="text-body-sm text-ink-muted">{t('settings.agents.setup.description')}</p>
        <p className="text-body-sm text-ink-subtle">
          {fresh
            ? t('settings.agents.setup.freshHint')
            : t('settings.agents.setup.placeholderHint', { placeholder })}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Field label={t('settings.agents.setup.clientLabel')} htmlFor="agent-client">
          <Select
            id="agent-client"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            data-testid="agent-client"
            className="sm:w-64"
          >
            {clients.map((block) => (
              <option key={block.id} value={block.id}>
                {block.name}
              </option>
            ))}
          </Select>
        </Field>
        <ul className="grid grid-cols-1 gap-3">
          <BlockCard
            key={chosenBlock(clients, clientId).id}
            block={chosenBlock(clients, clientId)}
            onCopy={copy}
          />
        </ul>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-h3">{t('settings.agents.skill.title')}</h3>
        <p className="text-body-sm text-ink-muted">{t('settings.agents.skill.description')}</p>
        <p className="text-body-sm text-ink-subtle">{t('settings.agents.skill.scrollHint')}</p>
        <Field label={t('settings.agents.setup.skillLabel')} htmlFor="agent-skill">
          <Select
            id="agent-skill"
            value={skillId}
            onChange={(event) => setSkillId(event.target.value)}
            data-testid="agent-skill"
            className="sm:w-64"
          >
            {skills.map((block) => (
              <option key={block.id} value={block.id}>
                {block.name}
              </option>
            ))}
          </Select>
        </Field>
        <ul className="grid grid-cols-1 gap-3">
          <BlockCard
            key={chosenBlock(skills, skillId).id}
            block={chosenBlock(skills, skillId)}
            onCopy={copy}
          />
        </ul>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="text-h3">{t('settings.agents.test.title')}</h3>
        <p className="text-body-sm text-ink-muted">{t('settings.agents.test.hint')}</p>

        {fresh === null && keys.length === 0 ? (
          <p className="text-body-sm text-ink-subtle">{t('settings.agents.test.noKey')}</p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {fresh === null ? (
              <Field
                label={t('settings.agents.test.with')}
                htmlFor="agent-key-test-target"
                className="sm:w-64"
              >
                <Select
                  id="agent-key-test-target"
                  value={target}
                  onChange={(event) => setTargetId(event.target.value)}
                  data-testid="agent-key-test-target"
                >
                  {keys.map((key) => (
                    <option key={key.id} value={key.id}>
                      {key.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Button
              variant="secondary"
              loading={test.isPending}
              disabled={target === ''}
              onClick={() => test.mutate()}
              data-testid="agent-key-test"
            >
              {t('settings.agents.test.run')}
            </Button>
          </div>
        )}

        {test.data ? (
          <p
            role="status"
            aria-live="polite"
            className="text-body-sm text-ink"
            data-testid="agent-key-test-result"
          >
            {resultText(test.data)}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The selected block, or the first one if the selection no longer exists. */
function chosenBlock(blocks: CopyBlock[], id: string): CopyBlock {
  return blocks.find((block) => block.id === id) ?? (blocks[0] as CopyBlock);
}

function BlockCard({
  block,
  onCopy,
}: {
  block: CopyBlock;
  onCopy: (value: string) => Promise<void>;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-sm border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="font-mono text-mono-sm text-ink-subtle">{block.name}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void onCopy(block.value)}
          aria-label={t('settings.agents.copyFor', { client: block.name })}
          data-testid={block.testId}
        >
          <Copy aria-hidden className="h-4 w-4" strokeWidth={1.5} />
          {t('settings.agents.copy')}
        </Button>
      </div>
      <pre
        className={cn(
          'overflow-x-auto whitespace-pre font-mono text-mono text-ink',
          block.capped === true ? 'max-h-56 overflow-y-auto' : null,
        )}
        {...(block.capped === true
          ? {
              tabIndex: 0,
              role: 'region',
              'aria-label': t('settings.agents.block', { client: block.name }),
            }
          : {})}
      >
        <code>{block.value}</code>
      </pre>
      {block.hint === undefined ? null : (
        <p className="text-body-sm text-ink-subtle">{block.hint}</p>
      )}
    </li>
  );
}

/** The server's answer, in the reader's language. Never a green tick. */
function resultText(result: AgentKeyTest): string {
  if (!result.ok) return t('settings.agents.test.refused', { reason: reasonText(result.reason) });
  const reached =
    result.board === null
      ? t('settings.agents.test.reachedUser', { name: result.key })
      : t('settings.agents.test.reachedBoard', {
          name: result.key,
          board: result.board.name,
          role:
            result.role === null
              ? t('settings.agents.role.none')
              : t(`board.members.role.${result.role}`),
        });
  // `inline` means the instance has no public URL: the endpoint was never asked,
  // so the answer says what it did not prove.
  return result.via === 'inline' ? `${reached} ${t('settings.agents.test.viaInline')}` : reached;
}

function reasonText(reason: AgentKeyRefusal): string {
  switch (reason) {
    case 'revoked':
      return t('settings.agents.test.reason.revoked');
    case 'expired':
      return t('settings.agents.test.reason.expired');
    case 'key_mismatch':
      return t('settings.agents.test.reason.keyMismatch');
    case 'key_required':
      return t('settings.agents.test.reason.keyRequired');
    case 'board_not_found':
      return t('settings.agents.test.reason.boardNotFound');
    case 'forbidden':
      return t('settings.agents.test.reason.forbidden');
    case 'unreachable':
      return t('settings.agents.test.reason.unreachable');
    case 'mcp_error':
      return t('settings.agents.test.reason.mcpError');
    default:
      return t('settings.agents.test.reason.unknown');
  }
}
