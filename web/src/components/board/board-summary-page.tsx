// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The close-out document (docs/features/close-out.md §4).
 *
 * A page, not a dialog: it is a record people paste into a report, so it has a
 * print stylesheet and no interactive affordance inside it. The same JSON is
 * what `GET /summary` returns and what `GET /summary.md` renders, so the screen
 * and the file cannot disagree.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '../../api/client';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';

function longDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

function shortDate(iso: string | null): string {
  if (iso === null) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
    new Date(iso),
  );
}

export function BoardSummaryPage({ boardId }: { boardId: string }) {
  const summary = useQuery({
    queryKey: queryKeys.summary(boardId),
    queryFn: () => api.summary(boardId),
  });

  if (summary.isPending) {
    return <p className="px-6 py-8 text-body-sm text-ink-subtle">{t('common.label.loading')}</p>;
  }
  if (summary.isError) {
    return (
      <div className="px-6 py-8">
        <p className="text-body-sm text-ink-muted">{t('board.summary.missing')}</p>
        <Link className="mt-3 inline-block text-body-sm text-ink underline" to="/boards">
          {t('board.summary.back')}
        </Link>
      </div>
    );
  }

  const data = summary.data;
  const outcome = t('board.summary.outcome', {
    done: data.counts.done,
    cards: data.counts.cards,
    days: data.span_days,
  });

  return (
    <article
      className="summary-page mx-auto max-w-[52rem] px-6 py-8 print:px-0"
      data-testid="summary"
    >
      <Link className="text-body-sm text-ink-muted underline print:hidden" to="/boards">
        {t('board.summary.back')}
      </Link>
      <header className="mt-4 border-b border-border pb-4">
        <h1 className="font-display text-display text-ink">{data.board.name}</h1>
        <p className="mt-1 font-mono text-mono-sm text-ink-subtle">
          {t('board.summary.closedOn', { date: longDate(data.closed_at) })}
        </p>
        <p className="mt-3 text-body text-ink-muted">{outcome}</p>
        <p className="mt-1 font-mono text-mono-sm text-ink-subtle">
          {t('board.summary.meta', {
            columns: data.counts.columns,
            members: data.counts.members,
            agents: data.counts.agents,
          })}
        </p>
      </header>

      <section className="mt-6">
        <h2 className="text-h2 text-ink">{t('board.summary.done')}</h2>
        {data.done.length === 0 ? (
          <p className="mt-2 text-body-sm text-ink-subtle">{t('board.summary.nothingDone')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {data.done.map((card) => (
              <li key={`${card.title}-${card.date ?? ''}`} className="flex justify-between gap-2">
                <span className="text-body-sm text-ink">{card.title}</span>
                <span className="shrink-0 font-mono text-mono-sm text-ink-subtle">
                  {card.assignee ?? '—'}
                  {card.date === null ? '' : ` · ${shortDate(card.date)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-h2 text-ink">{t('board.summary.remaining')}</h2>
        {data.remaining.length === 0 ? (
          <p className="mt-2 text-body-sm text-ink-subtle">{t('board.summary.nothingRemaining')}</p>
        ) : (
          data.remaining.map((group) => (
            <div key={group.column} className="mt-3">
              <h3 className="text-h3 text-ink">{group.column}</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {group.cards.map((card) => (
                  <li key={card.title} className="flex justify-between gap-2">
                    <span className="text-body-sm text-ink">{card.title}</span>
                    <span className="shrink-0 font-mono text-mono-sm text-ink-subtle">
                      {card.assignee ?? t('board.summary.unassigned')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-h2 text-ink">{t('board.summary.people')}</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {data.people.map((person) => (
            <li key={person.label} className="flex justify-between gap-2">
              <span className="text-body-sm text-ink">{person.label}</span>
              <span className="shrink-0 font-mono text-mono-sm text-ink-subtle">
                {t('board.summary.events', { count: person.events })}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {data.rhythm === '' ? null : (
        <section className="mt-6">
          <h2 className="text-h2 text-ink">{t('board.summary.rhythm')}</h2>
          <p className="mt-2 font-mono text-mono-lg text-ink-subtle" aria-hidden="true">
            {data.rhythm}
          </p>
        </section>
      )}

      {data.note === null ? null : (
        <section className="mt-6 border-t border-border pt-4">
          <h2 className="text-h2 text-ink">{t('board.summary.note')}</h2>
          <p className="mt-2 whitespace-pre-wrap text-body text-ink">{data.note}</p>
        </section>
      )}
    </article>
  );
}
