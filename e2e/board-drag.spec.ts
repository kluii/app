// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-04 and K2-06: the drag is a pointer gesture on a real board, and the
 * keyboard path is the same move through the same endpoint. The order is read
 * from the DOM after a reload, so an optimistic paint cannot pass this test.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openBoard, titlesIn, uniqueUsername } from './support';

/** pragmatic-dnd listens to pointer events: move, press, move in steps, release. */
async function pointerDrag(page: Page, from: Locator, to: Locator, toLowerHalf: boolean) {
  const source = await from.boundingBox();
  const target = await to.boundingBox();
  if (!source || !target) throw new Error('a drag endpoint has no box');

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2 + 12, {
    steps: 4,
  });
  const targetY = toLowerHalf ? target.y + target.height * 0.75 : target.y + target.height * 0.25;
  await page.mouse.move(target.x + target.width / 2, targetY, { steps: 12 });
  await page.mouse.up();
}

test('a card dropped above the first card stays there after a reload', async ({
  page,
  request,
}) => {
  const { columns, cards } = await openBoard(page, request, uniqueUsername('drag'));
  const [toDo] = columns;
  const [alpha, , charlie] = cards;
  if (!toDo || !alpha || !charlie) throw new Error('seeded cards are missing');

  const alphaRow = page.getByTestId(`card-${alpha.id}`);
  const charlieRow = page.getByTestId(`card-${charlie.id}`);

  await pointerDrag(page, charlieRow, alphaRow, false);
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Charlie', 'Alpha', 'Bravo']);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Charlie', 'Alpha', 'Bravo']);
});

test('a drop into another column lands there, and never opens the card', async ({
  page,
  request,
}) => {
  const { columns, cards } = await openBoard(page, request, uniqueUsername('across'));
  const [toDo, doing] = columns;
  const bravo = cards[1];
  if (!toDo || !doing || !bravo) throw new Error('seeded cards are missing');

  const doingColumn = page.getByTestId(`column-${doing.id}`);
  await pointerDrag(page, page.getByTestId(`card-${bravo.id}`), doingColumn, true);

  await expect.poll(() => titlesIn(page, doing)).toEqual(['Bravo']);
  // A drop ends with a click on the card: the dialog must stay shut.
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => titlesIn(page, doing)).toEqual(['Bravo']);
});

test('dropping on empty space appends', async ({ page, request }) => {
  const { columns, cards } = await openBoard(page, request, uniqueUsername('append'));
  const [toDo] = columns;
  const alpha = cards[0];
  if (!toDo || !alpha) throw new Error('seeded cards are missing');

  const columnBody = page.getByTestId(`column-${toDo.id}`);
  await pointerDrag(page, page.getByTestId(`card-${alpha.id}`), columnBody, true);

  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Bravo', 'Charlie', 'Alpha']);
});

test('the keyboard moves a card, announces it, and the order survives a reload', async ({
  page,
  request,
}) => {
  const { columns, cards } = await openBoard(page, request, uniqueUsername('keys'));
  const [toDo] = columns;
  const bravo = cards[1];
  if (!toDo || !bravo) throw new Error('seeded cards are missing');

  const bravoRow = page.getByTestId(`card-${bravo.id}`);
  await bravoRow.focus();
  await page.keyboard.press('Space');
  // A lift happens where the card already is: the first announcement must not
  // claim a move to the end of the column.
  await expect(page.getByTestId('drag-announcement')).toContainText('Bravo lifted');
  await expect(page.getByTestId('drag-announcement')).toContainText('position 2 of 3');

  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('drag-announcement')).toContainText('position 1 of 3');

  await page.keyboard.press('Space');
  await expect(page.getByTestId('drag-announcement')).toContainText('Bravo moved to To do');

  // The announcement is local: wait for the write before reloading, or the
  // reload can abort the request (PROMPT.md §10.1).
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Bravo', 'Alpha', 'Charlie']);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Bravo', 'Alpha', 'Charlie']);
});

test('the keyboard moves a card across columns with the left and right arrows', async ({
  page,
  request,
}) => {
  const { columns, cards } = await openBoard(page, request, uniqueUsername('acrosskeys'));
  const [toDo, doing] = columns;
  const alpha = cards[0];
  if (!toDo || !doing || !alpha) throw new Error('seeded cards are missing');

  await page.getByTestId(`card-${alpha.id}`).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');

  const order = async () => [
    ...(await titlesIn(page, toDo)),
    `|`,
    ...(await titlesIn(page, doing)),
  ];
  await expect.poll(order).toEqual(['Bravo', 'Charlie', '|', 'Alpha']);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(order).toEqual(['Bravo', 'Charlie', '|', 'Alpha']);
});

test('Escape cancels a keyboard move without writing', async ({ page, request }) => {
  const { columns, cards } = await openBoard(page, request, uniqueUsername('escape'));
  const [toDo] = columns;
  const alpha = cards[0];
  if (!toDo || !alpha) throw new Error('seeded cards are missing');

  await page.getByTestId(`card-${alpha.id}`).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Alpha', 'Bravo', 'Charlie']);
});
