// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';

/**
 * One live region for the whole app: a failure that only exists in the console
 * is a failure nobody saw. `aria-live="polite"` and a dismiss button, no
 * animation (DESIGN.md §9: every animation needs a static frame, and a toast
 * has no time for one).
 */
type Toast = { id: number; message: string; tone: 'info' | 'danger' };
type ToastApi = { notify: (message: string, tone?: Toast['tone']) => void };

const ToastContext = createContext<ToastApi>({ notify: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 6_000);
  }, []);

  const api = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-full max-w-96 -translate-x-1/2 flex-col gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            data-testid="toast"
            className={cn(
              'pointer-events-auto flex items-start justify-between gap-3 rounded-sm border bg-surface-raised px-3 py-2 text-body-sm',
              toast.tone === 'danger' ? 'border-danger text-danger' : 'border-border text-ink',
            )}
          >
            <span>{toast.message}</span>
            <button
              type="button"
              className="text-ink-subtle hover:text-ink"
              aria-label={t('common.action.dismiss')}
              onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
