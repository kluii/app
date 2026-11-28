// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-07 and K2-08, on a built server: a card opens as a read view with nothing
 * focused, Esc closes without saving, a dirty draft asks before it is thrown
 * away, Save persists, and a card can be moved and deleted from its menu.
 */
import { expect, test, type Page } from '@playwright/test';
import { openBoard, titlesIn, uniqueUsername } from './support';

async function focusedTag(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.tagName ?? 'none');
}

test('a card opens as a read view, and no input takes focus', async ({ page, request }) => {
  const { cards } = await openBoard(page, request, uniqueUsername('read'), ['Wire the digest']);
  const card = cards[0];
  if (!card) throw new Error('no card');

  await page.getByTestId(`card-${card.id}`).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 2, name: 'Wire the digest' })).toBeVisible();
  // Content first: no editable control exists for the platform to focus.
  await expect(dialog.locator('input, textarea, select')).toHaveCount(0);
  expect(await focusedTag(page)).not.toBe('INPUT');
  expect(await focusedTag(page)).not.toBe('TEXTAREA');
  await expect(dialog.getByText('No description')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Edit' })).toBeVisible();
});

test('Esc closes the read view without writing anything', async ({ page, request }) => {
  const { cards, columns } = await openBoard(page, request, uniqueUsername('esc'), ['Keep me']);
  const card = cards[0];
  const [toDo] = columns;
  if (!card || !toDo) throw new Error('no card');

  await page.getByTestId(`card-${card.id}`).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Keep me']);
});

test('a dirty draft asks before it is discarded, and Escape never saves', async ({
  page,
  request,
}) => {
  const { cards, columns } = await openBoard(page, request, uniqueUsername('dirty'), ['Original']);
  const card = cards[0];
  const [toDo] = columns;
  if (!card || !toDo) throw new Error('no card');

  await page.getByTestId(`card-${card.id}`).click();
  await page.getByRole('button', { name: 'Edit' }).click();

  const title = page.getByLabel('Card title');
  await expect(title).toBeFocused();
  await title.fill('Rewritten');

  // Escape with a dirty draft must not save and must not silently drop it.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog').getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Card title')).toHaveValue('Rewritten');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByLabel('Card title')).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Original']);
});

test('Save writes the title and the board shows it after a reload', async ({ page, request }) => {
  const { cards, columns, boardId } = await openBoard(page, request, uniqueUsername('save'), [
    'First draft',
  ]);
  const card = cards[0];
  const [toDo] = columns;
  if (!card || !toDo) throw new Error('no card');

  await page.getByTestId(`card-${card.id}`).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Card title').fill('Second draft');
  await page.getByRole('button', { name: 'Save' }).click();

  // Back in the read view, with the saved title.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { level: 2, name: 'Second draft' })).toBeVisible();

  const stored = (await (await request.get(`/api/v1/boards/${boardId}/state`)).json()) as {
    cards: { id: string; title: string }[];
  };
  expect(stored.cards.find((entry) => entry.id === card.id)?.title).toBe('Second draft');

  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Second draft']);
});

test('the create modal focuses the title and Ctrl+Enter saves', async ({ page, request }) => {
  const { columns } = await openBoard(page, request, uniqueUsername('create'), []);
  const [toDo] = columns;
  if (!toDo) throw new Error('no column');

  await page.getByTestId(`column-${toDo.id}`).getByRole('button', { name: 'Add card' }).click();
  const title = page.getByLabel('Card title');
  await expect(title).toBeFocused();
  await title.fill('Written with the keyboard');
  await title.press('Control+Enter');

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Written with the keyboard']);
});

test('the card menu moves a card to another column', async ({ page, request }) => {
  const { cards, columns } = await openBoard(page, request, uniqueUsername('menu'), ['Move me']);
  const card = cards[0];
  const [toDo, doing] = columns;
  if (!card || !toDo || !doing) throw new Error('no card');

  await page.getByTestId(`card-menu-${card.id}`).click();
  await page.getByRole('menuitem', { name: `Move to ${doing.name}` }).click();

  await expect.poll(() => titlesIn(page, doing)).toEqual(['Move me']);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => titlesIn(page, doing)).toEqual(['Move me']);
  expect(await titlesIn(page, toDo)).toEqual([]);
});

test('deleting from the card menu names the card and removes it', async ({ page, request }) => {
  const { cards, columns } = await openBoard(page, request, uniqueUsername('delete'), [
    'Doomed',
    'Survivor',
  ]);
  const card = cards[0];
  const [toDo] = columns;
  if (!card || !toDo) throw new Error('no card');

  await page.getByTestId(`card-menu-${card.id}`).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();

  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Doomed');
  await confirm.getByRole('button', { name: 'Delete' }).click();

  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Survivor']);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Survivor']);
});

/**
 * A deadline and an assignee are edited like the title is: from Edit, saved
 * explicitly, and stored as the API's two fields (`due_at` at noon UTC, and
 * `assignee` as a member id — never the free `assignee_label`).
 */
test('the editor sets a deadline and an assignee, and clears the day', async ({
  page,
  request,
}) => {
  const username = uniqueUsername('dated');
  const { cards, boardId } = await openBoard(page, request, username, ['Dated']);
  const card = cards[0];
  if (!card) throw new Error('no card');

  type Stored = {
    due_at: string | null;
    assignee: { id: string; username: string } | null;
    assignee_label: string | null;
  };
  const stored = async (): Promise<Stored | undefined> => {
    const state = (await (await request.get(`/api/v1/boards/${boardId}/state`)).json()) as {
      cards: (Stored & { id: string })[];
    };
    return state.cards.find((entry) => entry.id === card.id);
  };

  await page.getByTestId(`card-${card.id}`).click();
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Edit' }).click();

  await dialog.getByLabel('Due date').fill('2026-03-12');
  // Nobody is the first option; the board's own member is the second.
  await dialog.getByLabel('Assignee').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Save' }).click();

  // The read view is back, with the member as the assignee.
  await expect(dialog.getByRole('heading', { level: 2, name: 'Dated' })).toBeVisible();
  await expect(dialog.getByText(username)).toBeVisible();

  const saved = await stored();
  expect(saved?.due_at, 'a chosen day is stored at noon UTC').toBe('2026-03-12T12:00:00.000Z');
  expect(saved?.assignee?.username, 'the member is the assignee').toBe(username);
  expect(saved?.assignee_label, 'no free label beside a member').toBeNull();

  // The editor opens on the day the card now carries, and an empty field
  // clears the deadline instead of keeping it.
  await page.getByRole('button', { name: 'Edit' }).click();
  const dueInput = dialog.getByLabel('Due date');
  expect(await dueInput.inputValue(), 'the editor opens on the stored day').toBe('2026-03-12');
  await dueInput.fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('heading', { level: 2, name: 'Dated' })).toBeVisible();
  await expect
    .poll(async () => (await stored())?.due_at, { message: 'the day is cleared' })
    .toBeNull();
});
