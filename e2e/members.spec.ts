// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K3-05 in a browser: invite by username, change a role, remove, transfer.
 * A board has one owner at every instant; the UI never offers a control the
 * server would refuse.
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { PASSWORD, openBoard, openBoardMenu, uniqueUsername } from './support';

test('invite, change role, remove and transfer', async ({ page, request }) => {
  const username = uniqueUsername('team');
  const { boardId } = await openBoard(page, request, username, ['Alpha']);

  const guest = uniqueUsername('guest');
  const guestContext = await playwrightRequest.newContext({
    baseURL: test.info().project.use.baseURL,
  });
  await guestContext.post('/api/v1/auth/signup', {
    data: { email: `${guest}@klui.test`, username: guest, password: PASSWORD },
  });

  await openBoardMenu(page);
  await page.getByTestId('open-members').click();
  const dialog = page.getByRole('dialog');
  // A username is an identity, so the member list prints it with its at sign.
  await expect(dialog.getByText(`@${username}`)).toBeVisible();

  // Invite as editor.
  await dialog.getByLabel('Invite by username').fill(guest);
  await dialog.getByRole('button', { name: 'Add' }).click();
  const guestRow = dialog.locator('li', { hasText: guest });
  await expect(guestRow).toBeVisible();
  const guestSelect = guestRow.getByRole('combobox');
  await expect(guestSelect).toHaveValue('editor');

  // Change the role; it survives a reload.
  await guestSelect.selectOption('viewer');
  await expect(guestSelect).toHaveValue('viewer');
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openBoardMenu(page);
  await page.getByTestId('open-members').click();
  await expect(
    page.getByRole('dialog').locator('li', { hasText: guest }).getByRole('combobox'),
  ).toHaveValue('viewer');

  // Remove, then invite again for the transfer.
  const dialogAgain = page.getByRole('dialog');
  await dialogAgain
    .locator('li', { hasText: guest })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(dialogAgain.locator('li', { hasText: guest })).toHaveCount(0);
  await dialogAgain.getByLabel('Invite by username').fill(guest);
  await dialogAgain.getByRole('button', { name: 'Add' }).click();
  await expect(dialogAgain.locator('li', { hasText: guest })).toBeVisible();

  // Transfer ownership: the guest becomes the only owner, the founder an admin.
  await dialogAgain
    .locator('li', { hasText: guest })
    .getByRole('button', { name: 'Make owner' })
    .click();
  const guestRowAgain = dialogAgain.locator('li', { hasText: guest });
  await expect(guestRowAgain.getByText('owner')).toBeVisible();
  await expect(dialogAgain.locator('li', { hasText: username }).getByRole('combobox')).toHaveValue(
    'admin',
  );

  const members = await harnessMembers(boardId);
  expect(members.filter((entry) => entry.role === 'owner').map((entry) => entry.username)).toEqual([
    guest,
  ]);
  await guestContext.dispose();

  async function harnessMembers(id: string): Promise<{ username: string; role: string }[]> {
    const response = await request.get(`/api/v1/boards/${id}/members`);
    expect(response.ok()).toBeTruthy();
    return ((await response.json()) as { items: { username: string; role: string }[] }).items;
  }
});

/**
 * The server explains a 4xx and the UI repeats it (docs/api.md §1).
 *
 * The dialog used to print "Something went wrong. Try again." — or the bare
 * message — while the body carried a hint written for exactly this moment.
 */
test('a refusal shows the server explanation, not a generic apology', async ({ page, request }) => {
  await openBoard(page, request, uniqueUsername('explain'), ['Alpha']);
  await openBoardMenu(page);
  await page.getByTestId('open-members').click();
  const dialog = page.getByRole('dialog');

  await dialog.getByLabel('Invite by username').fill('nobody-here');
  await dialog.getByRole('button', { name: 'Add' }).click();

  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText('No account with that username.');
  // The hint is the half the old dialog dropped: the message is not the fix.
  await expect(alert).toContainText('the person has to sign up first');
  await expect(alert).not.toContainText('Something went wrong');
});
