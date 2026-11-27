// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';
import { ToastProvider } from './components/ui/toast';
import { getSnapshot, subscribe } from './i18n';
import { queryClient } from './lib/query-client';
import { router } from './routes/router';

/**
 * A language change remounts the tree: `t()` is a plain function read during
 * render, so a `key` is the honest way to re-render everything at once. The
 * alternative — two hundred components each subscribing to the store — buys a
 * cheaper transition for a cost paid on every page, forever.
 */
function LocaleBoundary() {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <div key={locale} className="contents">
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleBoundary />
    </QueryClientProvider>
  );
}
