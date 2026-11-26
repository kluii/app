// SPDX-License-Identifier: AGPL-3.0-only
import { createRoute } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Chip } from '../components/ui/chip';
import { Dialog } from '../components/ui/dialog';
import { DropdownItem, DropdownMenu } from '../components/ui/dropdown-menu';
import { Field } from '../components/ui/field';
import { Input, Select, Textarea } from '../components/ui/input';
import { Separator } from '../components/ui/separator';
import { Spinner } from '../components/ui/spinner';
import { TagChip } from '../components/board/tag-chip';
import { useToast } from '../components/ui/toast';
import { Tooltip } from '../components/ui/tooltip';
import { t } from '../i18n';
import { rootRoute } from './root';

/**
 * K2-02: the one page where every primitive is visible in every state. It is
 * not linked from the app and it holds no product copy: it exists so `axe` and
 * a human can check the components once, in both themes.
 */
export const styleguideRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/styleguide',
  component: StyleguidePage,
});

type State = 'default' | 'hover' | 'active' | 'focus' | 'disabled' | 'loading' | 'error';

function stateLabel(state: State): string {
  return t(`styleguide.state.${state}`);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h2">{title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function Cell({ state, children }: { state: State; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <span className="font-mono text-mono-sm text-ink-subtle">{stateLabel(state)}</span>
      <div className="flex min-h-9 items-center">{children}</div>
    </div>
  );
}

function StyleguidePage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toast = useToast();
  // A tag colour is user data; the specimen reads the token so this page holds
  // no colour literal (DESIGN.md §15).
  const tagColour = useMemo(
    () => getComputedStyle(document.documentElement).getPropertyValue('--tag-red').trim(),
    [],
  );

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-8 px-6 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">{t('styleguide.title')}</h1>
        <p className="max-w-140 text-body-sm text-ink-muted">{t('styleguide.intro')}</p>
      </header>

      <Section title={t('styleguide.section.button')}>
        <Cell state="default">
          <Button variant="primary">{t('common.action.save')}</Button>
        </Cell>
        <Cell state="hover">
          <Button variant="secondary" className="bg-surface-muted">
            {t('common.action.save')}
          </Button>
        </Cell>
        <Cell state="active">
          <Button variant="primary" className="brightness-95">
            {t('common.action.save')}
          </Button>
        </Cell>
        <Cell state="focus">
          <Button variant="secondary" autoFocus>
            {t('common.action.save')}
          </Button>
        </Cell>
        <Cell state="disabled">
          <Button variant="secondary" disabled>
            {t('common.action.save')}
          </Button>
        </Cell>
        <Cell state="loading">
          <Button variant="primary" loading>
            {t('common.action.save')}
          </Button>
        </Cell>
      </Section>

      <Separator />

      <Section title={t('styleguide.section.input')}>
        <Cell state="default">
          <Input value={t('styleguide.value')} readOnly aria-label={t('styleguide.value')} />
        </Cell>
        <Cell state="focus">
          <Input
            value={t('styleguide.value')}
            readOnly
            aria-label={t('styleguide.value')}
            autoFocus
          />
        </Cell>
        <Cell state="disabled">
          <Input
            value={t('styleguide.value')}
            readOnly
            disabled
            aria-label={t('styleguide.value')}
          />
        </Cell>
        <Cell state="error">
          <Field label={t('styleguide.value')} htmlFor="sg-error" error={t('common.error.generic')}>
            <Input id="sg-error" aria-invalid readOnly value={t('styleguide.value')} />
          </Field>
        </Cell>
        <Cell state="default">
          <Textarea
            readOnly
            rows={2}
            value={t('styleguide.value')}
            aria-label={t('styleguide.value')}
          />
        </Cell>
        <Cell state="disabled">
          <Textarea
            readOnly
            rows={2}
            disabled
            value={t('styleguide.value')}
            aria-label={t('styleguide.value')}
          />
        </Cell>
        <Cell state="default">
          <Select aria-label={t('styleguide.value')} defaultValue="one">
            <option value="one">{t('styleguide.value')}</option>
          </Select>
        </Cell>
        <Cell state="disabled">
          <Select aria-label={t('styleguide.value')} defaultValue="one" disabled>
            <option value="one">{t('styleguide.value')}</option>
          </Select>
        </Cell>
      </Section>

      <Separator />

      <Section title={t('styleguide.section.checkbox')}>
        <Cell state="default">
          <Checkbox id="sg-check" label={t('styleguide.value')} />
        </Cell>
        <Cell state="default">
          <Checkbox id="sg-checked" label={t('styleguide.value')} defaultChecked />
        </Cell>
        <Cell state="focus">
          <Checkbox id="sg-focus" label={t('styleguide.value')} autoFocus />
        </Cell>
        <Cell state="disabled">
          <Checkbox id="sg-disabled" label={t('styleguide.value')} disabled />
        </Cell>
      </Section>

      <Separator />

      <Section title={t('styleguide.section.chip')}>
        <Cell state="default">
          <Chip>{t('styleguide.tag')}</Chip>
        </Cell>
        <Cell state="default">
          <TagChip tag={{ name: t('styleguide.tag'), color: tagColour }} />
        </Cell>
        <Cell state="default">
          <TagChip tag={{ name: t('styleguide.tag'), color: tagColour }} />
        </Cell>
        <Cell state="default">
          <TagChip tag={{ name: t('styleguide.tag'), color: null }} />
        </Cell>
      </Section>

      <Separator />

      <Section title={t('styleguide.section.dialog')}>
        <Cell state="default">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            {t('styleguide.open')}
          </Button>
        </Cell>
      </Section>

      <Section title={t('styleguide.section.popover')}>
        <Cell state="default">
          <DropdownMenu label={t('styleguide.open')} open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownItem onSelect={() => setMenuOpen(false)}>
              {t('common.action.edit')}
            </DropdownItem>
            <DropdownItem onSelect={() => setMenuOpen(false)} tone="danger">
              {t('common.action.delete')}
            </DropdownItem>
          </DropdownMenu>
        </Cell>
      </Section>

      <Section title={t('styleguide.section.tooltip')}>
        <Cell state="default">
          <Tooltip label={t('styleguide.section.tooltip')}>
            <Button variant="ghost">{t('styleguide.open')}</Button>
          </Tooltip>
        </Cell>
      </Section>

      <Section title={t('styleguide.section.toast')}>
        <Cell state="default">
          <Button variant="secondary" onClick={() => toast.notify(t('styleguide.showToast'))}>
            {t('styleguide.showToast')}
          </Button>
        </Cell>
        <Cell state="error">
          <Button
            variant="secondary"
            onClick={() => toast.notify(t('common.error.generic'), 'danger')}
          >
            {t('styleguide.showToast')}
          </Button>
        </Cell>
      </Section>

      <Separator />

      <Section title={t('styleguide.section.table')}>
        <Cell state="default">
          <table className="w-full text-body-sm">
            <caption className="sr-only">{t('styleguide.section.table')}</caption>
            <thead>
              <tr className="text-left text-label text-ink-muted">
                <th scope="col">{t('styleguide.row')}</th>
                <th scope="col">{t('styleguide.value')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <td>{t('styleguide.row')}</td>
                <td className="font-mono text-mono">{t('styleguide.value')}</td>
              </tr>
            </tbody>
          </table>
        </Cell>
      </Section>

      <Section title={t('styleguide.section.separator')}>
        <Cell state="default">
          <Separator />
        </Cell>
      </Section>

      <Section title={t('styleguide.section.spinner')}>
        <Cell state="default">
          <Spinner />
        </Cell>
        <Cell state="loading">
          <Spinner label={t('styleguide.state.loading')} />
        </Cell>
      </Section>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={t('styleguide.section.dialog')}
        footer={
          <Button variant="primary" onClick={() => setDialogOpen(false)}>
            {t('styleguide.close')}
          </Button>
        }
      >
        <p className="text-body-sm text-ink-muted">{t('styleguide.intro')}</p>
      </Dialog>
    </div>
  );
}
