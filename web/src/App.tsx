// SPDX-License-Identifier: AGPL-3.0-only
import { t } from './i18n';

/** Placeholder shell: the routed app lands with the web shell task. */
export function App() {
  return (
    <main className="mx-auto max-w-content px-6 py-10">
      <h1 className="text-h1">{t('common.app.name')}</h1>
    </main>
  );
}
