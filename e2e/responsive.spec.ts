// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-13 at 390 × 844, the width a phone actually has.
 *
 * Three claims, measured rather than assumed: the page itself never scrolls
 * sideways (only the rail does), a card still lands in the middle of a
 * populated column and stays there after a reload, and axe is clean at both
 * widths.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openBoard, titlesIn, uniqueUsername } from './support';

test.use({ viewport: { width: 390, height: 844 } });

test('nothing but the rail scrolls sideways at 390 px', async ({ page, request }) => {
  const { columns } = await openBoard(page, request, uniqueUsername('narrow'), [
    'One',
    'Two',
    'Three',
  ]);
  expect(columns.length).toBeGreaterThanOrEqual(3);

  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);

  // The rail is the one container allowed to overflow, and it does.
  const rail = await page.getByTestId('board-scroll').evaluate((element) => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
  }));
  expect(rail.scroll).toBeGreaterThan(rail.client);

  // A column header is a normal header in the flow: the page scrolls vertically
  // as one, and the column is not a scrollport of its own.
  const firstColumn = page.getByTestId(`column-${columns[0]?.id ?? ''}`);
  const header = firstColumn.locator('header').first();
  await expect(header).toBeVisible();
  const position = await header.evaluate((element) => getComputedStyle(element).position);
  expect(position).toBe('static');
});

test('a card dropped into the middle of a column stays there after a reload', async ({
  page,
  request,
}) => {
  const { cards, columns } = await openBoard(page, request, uniqueUsername('touchdrag'), [
    'Alpha',
    'Bravo',
    'Charlie',
  ]);
  const [alpha, bravo, charlie] = cards;
  const [toDo, doing] = columns;
  if (!alpha || !bravo || !charlie || !toDo || !doing) throw new Error('seed failed');

  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Alpha', 'Bravo', 'Charlie']);

  const source = page.getByTestId(`card-${charlie.id}`);
  const target = page.getByTestId(`card-${alpha.id}`);
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('no boxes');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // A first small move crosses the 8 px activation distance, a second lands on
  // the upper half of Alpha: insertion above it, never below.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 6, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => titlesIn(page, toDo)).toEqual(['Charlie', 'Alpha', 'Bravo']);
});

test('axe finds nothing at 390 px or at 1280 px', async ({ page, request }) => {
  await openBoard(page, request, uniqueUsername('axe'), ['Alpha', 'Bravo']);

  const narrow = await new AxeBuilder({ page }).analyze();
  expect(narrow.violations.map((violation) => violation.id)).toEqual([]);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const wide = await new AxeBuilder({ page }).analyze();
  expect(wide.violations.map((violation) => violation.id)).toEqual([]);
});
