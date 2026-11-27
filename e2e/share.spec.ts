// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-06 in a browser: the sharing panel is the only place a write token exists,
 * and it never shows one it could not show again.
 */
import { expect, test } from '@playwright/test';
import { openBoard, uniqueUsername } from './support';

test('the sharing panel sets visibility, hands out one token, and rotates with confirmation', async ({
  page,
  request,
}) => {
  const username = uniqueUsername('sharing');
  const { boardId } = await openBoard(page, request, username, ['Alpha']);

  await page.getByTestId('open-share').click();
  const dialog = page.getByRole('dialog');

  // Private: no URL, no link controls.
  await expect(
    dialog.getByText('A private board is readable only by its members', { exact: false }),
  ).toBeVisible();
  await expect(dialog.getByLabel('Readable URL')).toHaveCount(0);

  // Link: a suffixed URL appears.
  await dialog.getByLabel('Visibility').selectOption('link');
  const url = dialog.getByLabel('Readable URL');
  await expect(url).toBeVisible();
  const firstUrl = await url.inputValue();
  expect(firstUrl).toMatch(new RegExp(`/${username}/board-under-test-[a-z2-9]{4}$`, 'u'));

  // A write link on a members-only board would be dead on arrival: the panel
  // says so, and the test chooses a role first.
  await expect(
    dialog.getByText('Choose "can read" or "can edit" above', { exact: false }),
  ).toBeVisible();
  await dialog.getByLabel('Readable link').selectOption('read');
  await expect(
    dialog.getByText('Choose "can read" or "can edit" above', { exact: false }),
  ).toHaveCount(0);

  // One token, once.
  await dialog.getByTestId('create-link').click();
  const token = dialog.getByLabel('Write link');
  await expect(token).toBeVisible();
  const tokenUrl = await token.inputValue();
  expect(tokenUrl).toMatch(/\/l\/[0-9A-Za-z]{22,}$/u);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('open-share').click();
  const reopened = page.getByRole('dialog');
  await expect(reopened.getByLabel('Write link')).toHaveCount(0);
  await expect(reopened.getByText('never used')).toBeVisible();

  // Rotation is two steps, and the old URL dies.
  await reopened.getByTestId('rotate-suffix').click();
  await expect(reopened.getByText('The current link stops working immediately.')).toBeVisible();
  await reopened.getByRole('button', { name: 'Yes, regenerate' }).click();
  // The refetch is what changes the field: wait for the new URL, do not race it.
  await expect(reopened.getByLabel('Readable URL')).not.toHaveValue(firstUrl);
  const secondUrl = await reopened.getByLabel('Readable URL').inputValue();
  expect(secondUrl).toMatch(new RegExp(`/${username}/board-under-test-[a-z2-9]{4}$`, 'u'));

  // The page shell is always 200; the resolver is what decides existence.
  const oldSegment = new URL(firstUrl).pathname.split('/').filter(Boolean).pop() ?? '';
  const old = await request.get(`/api/v1/users/${username}/boards/${oldSegment}/resolve`);
  expect(old.status()).toBe(404);

  // The created link still works; revoking it kills it.
  // No redirect following: the 302 is the whole point of the door.
  const visitor = await page.request.get(tokenUrl.replace(/^https?:\/\/[^/]+/u, ''), {
    maxRedirects: 0,
  });
  expect(visitor.status()).toBe(302);

  await reopened.getByRole('button', { name: 'Revoke' }).click();
  await expect(reopened.getByText('revoked')).toBeVisible();
  const afterRevoke = await page.request.get(tokenUrl.replace(/^https?:\/\/[^/]+/u, ''));
  expect(afterRevoke.status()).toBe(404);

  expect(boardId).toBeTruthy();
});
