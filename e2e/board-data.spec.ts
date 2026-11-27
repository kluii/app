// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-11 in a browser: the two exports are real downloads with the server's file
 * names, and an import chosen from disk lands on the board without a reload the
 * user has to know about.
 *
 * The byte-identical round-trip is a server test (`test/export-import.test.ts`);
 * this file proves the human path the roadmap's "export from a board, import
 * into an empty instance" sentence describes.
 */
import { expect, test } from '@playwright/test';
import { openBoard, openBoardMenu, uniqueUsername } from './support';

test('the Data dialog downloads the JSON and the markdown of the board', async ({
  page,
  request,
}) => {
  const { boardId } = await openBoard(page, request, uniqueUsername('data'), ['Wire the digest']);

  await openBoardMenu(page);
  await page.getByTestId('open-board-data').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('export-json')).toHaveAttribute(
    'href',
    `/api/v1/boards/${boardId}/export.json`,
  );
  await expect(dialog.getByTestId('export-markdown')).toHaveAttribute(
    'href',
    `/api/v1/boards/${boardId}/export.md`,
  );

  const download = page.waitForEvent('download');
  await dialog.getByTestId('export-json').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('board-under-test-klui.json');
  await expect(dialog).toBeVisible();
});

test('an imported file appears on the board, and says what it carried', async ({
  page,
  request,
}) => {
  const { columns } = await openBoard(page, request, uniqueUsername('import'), []);
  const [first] = columns;
  if (!first) throw new Error('no column');

  const file = {
    schema: 'klui.export/v2',
    columns: [{ id: 'col_imported00000000000000', name: first.name, position: 1024 }],
    cards: [
      {
        id: 'crd_imported00000000000000',
        column_id: 'col_imported00000000000000',
        title: 'From a file',
      },
      {
        id: 'crd_imported11111111111111',
        column_id: 'col_imported00000000000000',
        title: 'Also from a file',
      },
    ],
  };

  await openBoardMenu(page);
  await page.getByTestId('open-board-data').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('import-file').setInputFiles({
    name: 'board.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file), 'utf8'),
  });
  await dialog.getByTestId('import-submit').click();

  await expect(dialog.getByTestId('import-result')).toContainText('Imported 2 cards');
  await dialog.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByText('From a file', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('From a file', { exact: true })).toBeVisible();
  await expect(page.getByText('Also from a file', { exact: true })).toBeVisible();
});

test('a file that is not an export is refused, and the board is untouched', async ({
  page,
  request,
}) => {
  const { columns } = await openBoard(page, request, uniqueUsername('badimport'), ['Untouched']);
  expect(columns.length).toBeGreaterThan(0);

  await openBoardMenu(page);
  await page.getByTestId('open-board-data').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('import-file').setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8'),
  });
  await dialog.getByTestId('import-submit').click();

  await expect(dialog.getByTestId('import-error')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Untouched')).toBeVisible();
  await expect(page.getByText('hello')).toHaveCount(0);
});
