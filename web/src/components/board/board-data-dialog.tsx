// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The way out and the way in (docs/features/import-export.md).
 *
 * Export is two download links, not a fetch: the browser already holds the
 * session cookie, and a link gives the user the file with its server-chosen
 * name without the SPA ever holding the bytes. Import is one file and one
 * button; the result is read from the job, never assumed.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, type ImportResult } from '../../api/client';
import { failureMessage } from '../../lib/api-error';
import { t } from '../../i18n';
import { queryKeys } from '../../lib/query-client';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';

export function BoardDataDialog({
  boardId,
  canImport,
  open,
  onClose,
}: {
  boardId: string;
  /** Export is a read; import writes a board, so it is offered only to a manager (K3-08). */
  canImport: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importFile = useMutation({
    mutationFn: (input: File) => api.importBoard(boardId, input),
    onSuccess: (response) => {
      setResult(response.result);
      setError(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      void queryClient.invalidateQueries({ queryKey: queryKeys.board(boardId) });
    },
    onError: (cause) => {
      setResult(null);
      setError(failureMessage(cause));
    },
  });

  const close = (): void => {
    setResult(null);
    setError(null);
    setFile(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('board.data.title')}
      description={t('board.data.description')}
      footer={
        <Button size="sm" variant="ghost" onClick={close}>
          {t('common.action.close')}
        </Button>
      }
    >
      <section className="flex flex-col gap-2">
        <h3 className="text-h3">{t('board.data.export')}</h3>
        <div className="flex flex-wrap gap-2">
          <a
            className="inline-flex h-8 items-center rounded-sm border border-border bg-surface-2 px-3 text-body-sm text-ink hover:bg-surface-muted"
            href={`/api/v1/boards/${boardId}/export.json`}
            download
            data-testid="export-json"
          >
            {t('board.data.exportJson')}
          </a>
          <a
            className="inline-flex h-8 items-center rounded-sm border border-border bg-surface-2 px-3 text-body-sm text-ink hover:bg-surface-muted"
            href={`/api/v1/boards/${boardId}/export.md`}
            download
            data-testid="export-markdown"
          >
            {t('board.data.exportMarkdown')}
          </a>
        </div>
        <p className="text-body-sm text-ink-subtle">{t('board.data.exportHint')}</p>
      </section>

      {canImport ? (
        <section className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="text-h3">{t('board.data.import')}</h3>
          <p className="text-body-sm text-ink-subtle">{t('board.data.importHint')}</p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="text-body-sm text-ink-muted file:mr-3 file:h-8 file:rounded-sm file:border file:border-border file:bg-surface-2 file:px-3 file:text-body-sm file:text-ink"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
            data-testid="import-file"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={file === null}
              loading={importFile.isPending}
              onClick={() => {
                if (file !== null) importFile.mutate(file);
              }}
              data-testid="import-submit"
            >
              {t('board.data.importSubmit')}
            </Button>
          </div>
          {result !== null ? (
            <p className="text-body-sm text-ink-muted" role="status" data-testid="import-result">
              {t('board.data.imported', {
                cards: result.cards,
                comments: result.comments,
                columns: result.columns,
              })}
            </p>
          ) : null}
          {error !== null ? (
            <p className="text-body-sm text-danger" role="alert" data-testid="import-error">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}
    </Dialog>
  );
}
