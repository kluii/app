// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One section at a time, chosen from a rail (the owner's rule for this screen:
 * you pick the thing you came for, you do not scroll past eight others).
 *
 * The choice lives in `?section=`, so a deep link opens the right panel and a
 * reload keeps it. Only the selected panel is mounted: a section that polls
 * must not run while you are reading another one.
 */
import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import {
  Bell,
  Bot,
  KeyRound,
  MonitorSmartphone,
  Newspaper,
  Palette,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { api } from '../api/client';
import { AgentsSettings } from '../components/settings/agents-settings';
import { BrandingSettings } from '../components/settings/branding-settings';
import { DangerSettings } from '../components/settings/danger-settings';
import { DigestSettings } from '../components/settings/digest-settings';
import { NotificationsSettings } from '../components/settings/notifications-settings';
import { OidcSettings } from '../components/settings/oidc-settings';
import { ProfileSettings } from '../components/settings/profile-settings';
import { SecuritySettings } from '../components/settings/security-settings';
import { SessionsSettings } from '../components/settings/sessions-settings';
import { t } from '../i18n';
import { cn } from '../lib/cn';
import { queryKeys } from '../lib/query-client';
import { authedRoute } from './authed';

type SectionId =
  | 'profile'
  | 'sessions'
  | 'digest'
  | 'notifications'
  | 'agents'
  | 'security'
  | 'sso'
  | 'instance'
  | 'danger';

type Section = {
  icon: LucideIcon;
  /** Instance branding is an admin screen; every other account never sees the row. */
  adminOnly?: boolean;
  panel: () => ReactNode;
};

/** The rail's order: the order these questions are answered in, not alphabetical. */
const ORDER: readonly SectionId[] = [
  'profile',
  'sessions',
  'digest',
  'notifications',
  'agents',
  'security',
  'sso',
  'instance',
  'danger',
];

const SECTIONS: Record<SectionId, Section> = {
  profile: { icon: UserRound, panel: () => <ProfileSettings /> },
  sessions: { icon: MonitorSmartphone, panel: () => <SessionsSettings /> },
  digest: { icon: Newspaper, panel: () => <DigestSettings /> },
  notifications: { icon: Bell, panel: () => <NotificationsSettings /> },
  agents: { icon: Bot, panel: () => <AgentsSettings /> },
  security: { icon: ShieldCheck, panel: () => <SecuritySettings /> },
  sso: { icon: KeyRound, panel: () => <OidcSettings /> },
  instance: { icon: Palette, adminOnly: true, panel: () => <BrandingSettings /> },
  danger: { icon: TriangleAlert, panel: () => <DangerSettings /> },
};

const DEFAULT_SECTION: SectionId = 'profile';

function isSectionId(value: unknown): value is SectionId {
  return typeof value === 'string' && ORDER.some((id) => id === value);
}

export const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings',
  validateSearch: (search: Record<string, unknown>): { section?: SectionId } =>
    isSectionId(search.section) ? { section: search.section } : {},
  component: SettingsPage,
});

function SettingsPage() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me, retry: false });
  const requested = settingsRoute.useSearch().section;
  const navigate = useNavigate();
  const tabs = useRef(new Map<SectionId, HTMLButtonElement>());

  const visible = ORDER.filter(
    (id) => SECTIONS[id].adminOnly !== true || me.data?.is_instance_admin === true,
  );
  // An unknown or forbidden section falls back to the first panel rather than
  // to an empty screen: the URL is a request, not a promise.
  const active: SectionId =
    requested !== undefined && visible.includes(requested) ? requested : DEFAULT_SECTION;

  const select = (id: SectionId): void => {
    void navigate({ to: '/settings', search: { section: id } });
  };

  // On the narrow layout the rail is a strip that can be wider than the screen:
  // a deep link must not leave the row you arrived for off to the right. The
  // column never scrolls, so this does nothing above 768 px.
  useEffect(() => {
    const tab = tabs.current.get(active);
    const list = tab?.parentElement;
    if (!tab || !list || list.scrollWidth <= list.clientWidth) return;
    tab.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [active]);

  // The same contract as the account menu: arrows walk the list, Home and End
  // jump to its ends, and focus follows the selection so a second arrow works.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = visible.indexOf(active);
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    let next: SectionId | undefined;
    if (step !== 0) next = visible[(index + step + visible.length) % visible.length];
    else if (event.key === 'Home') next = visible[0];
    else if (event.key === 'End') next = visible[visible.length - 1];
    else return;
    event.preventDefault();
    if (next === undefined) return;
    select(next);
    tabs.current.get(next)?.focus();
  };

  return (
    <div className="mx-auto w-full max-w-content px-6 py-8">
      <h1 className="font-display text-h1">{t('settings.title')}</h1>

      {/* The rail is a column of rows, not a stack of pills: 36 high, 24 of
          padding, one radius, an icon in a fixed 16 px column. Under 768 px it
          is the same rows scrolling sideways, so the pattern keeps one shape. */}
      <div className="mt-6 flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
        <nav aria-label={t('settings.rail.label')} className="min-w-0 md:w-56 md:shrink-0">
          <div
            role="tablist"
            aria-orientation="vertical"
            data-testid="settings-rail"
            onKeyDown={onKeyDown}
            className="flex snap-x snap-mandatory gap-0.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0"
          >
            {visible.map((id) => {
              const selected = id === active;
              const Icon = SECTIONS[id].icon;
              return (
                <button
                  key={id}
                  ref={(element) => {
                    if (element === null) tabs.current.delete(id);
                    else tabs.current.set(id, element);
                  }}
                  type="button"
                  role="tab"
                  id={`settings-tab-${id}`}
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  data-testid={`settings-tab-${id}`}
                  onClick={() => select(id)}
                  className={cn(
                    'inline-flex h-9 shrink-0 snap-start items-center gap-2 rounded-sm px-3 text-label transition-colors duration-[var(--dur-fast)] md:w-full',
                    selected
                      ? 'bg-surface-muted text-ink'
                      : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
                  )}
                >
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span className="whitespace-nowrap">{t(`settings.section.${id}`)}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div
          role="tabpanel"
          id={`settings-panel-${active}`}
          aria-labelledby={`settings-tab-${active}`}
          data-testid="settings-panel"
          data-section={active}
          className="min-w-0 flex-1 max-w-240"
        >
          {SECTIONS[active].panel()}
        </div>
      </div>
    </div>
  );
}
