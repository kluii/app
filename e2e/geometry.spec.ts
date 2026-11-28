// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The board's geometry, measured instead of assumed (redesign brief §8).
 *
 * Every value here is an exact equality: a screen that drifts by 2 px fails this
 * file, not a screenshot review. The board's live stream keeps a socket open, so
 * `networkidle` never fires — `openBoard` waits for `domcontentloaded` plus the
 * board heading, and every number below is read from `getBoundingClientRect()`
 * or `getComputedStyle()`.
 *
 * Phase 1 covers the 4 px grid: the bar's height, a card's padding, the gap
 * between two cards, the gap between two columns. The rest of the plan, added by
 * the phase that builds it:
 *   - shell header 56, logo 24, no bottom border on the board route;
 *   - 390 × 844: `documentElement.scrollWidth` ≤ 390, the second column starts
 *     before x = 390, the board bar is two rows of 48 and 40;
 *   - 1440 × 900 on `/boards` with four boards: four tiles on one row, equal
 *     heights.
 *
 * Phase 6 (board layout) adds the board half of that plan: first column at
 * x = 24, column width 288, card width 270 on top of the phase 1 measurements.
 */
import { expect, test, type Locator } from '@playwright/test';
import { openBoard, uniqueUsername } from './support';

test.use({ viewport: { width: 1440, height: 900 } });

type Box = { x: number; y: number; width: number; height: number; right: number; bottom: number };

async function box(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const { x, y, width, height, right, bottom } = rect;
    return { x, y, width, height, right, bottom };
  });
}

test('the board is drawn on the 4 px grid', async ({ page, request }) => {
  const { cards, columns } = await openBoard(page, request, uniqueUsername('geometry'));
  const [toDo, doing] = columns;
  const [first, second] = cards;
  if (!toDo || !doing || !first || !second) throw new Error('seed failed');

  // The bar is one 56 px row above the rail.
  expect((await box(page.getByTestId('board-bar'))).height, 'board bar height').toBe(56);

  // The rail starts at its 24 px padding: the first column sits at x = 24 and
  // is 288 wide, so the card inside it (2 px of column border, 16 px of column
  // padding) is 270 wide.
  const leftColumn = await box(page.getByTestId(`column-${toDo.id}`));
  const rightColumn = await box(page.getByTestId(`column-${doing.id}`));
  expect(leftColumn.x, 'first column x').toBe(24);
  expect(leftColumn.width, 'column width').toBe(288);

  // A card is padded 12 on all four sides. The row is the card's box: its only
  // child is the surface that carries the padding.
  const firstRow = page.getByTestId(`card-${first.id}`).locator('..');
  const secondRow = page.getByTestId(`card-${second.id}`).locator('..');
  expect((await box(firstRow)).width, 'card width').toBe(270);
  const padding = await firstRow.evaluate((row) => {
    const body = row.firstElementChild;
    if (body === null) throw new Error('the card has no body');
    const style = getComputedStyle(body);
    return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft];
  });
  expect(padding, 'card padding, clockwise from the top').toEqual(['12px', '12px', '12px', '12px']);

  // Two cards stacked in one column sit 8 apart.
  expect((await box(secondRow)).y - (await box(firstRow)).bottom, 'gap between two cards').toBe(8);

  // Two columns side by side sit 16 apart.
  expect(rightColumn.x - leftColumn.right, 'gap between two columns').toBe(16);
});

test.describe('at 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the bar stacks on two rows and the next column peeks', async ({ page, request }) => {
    const { columns } = await openBoard(page, request, uniqueUsername('geometry-mobile'));
    const [toDo, doing] = columns;
    if (!toDo || !doing) throw new Error('seed failed');

    // Only the rail scrolls sideways: the page itself is exactly 390 wide.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      'document scroll width',
    ).toBeLessThanOrEqual(390);

    // The rail is padded 12 on a phone, so the first column ends at
    // x = 300 and the second one starts at 12 + 288 + 16 = 316: it peeks.
    const firstColumn = await box(page.getByTestId(`column-${toDo.id}`));
    const secondColumn = await box(page.getByTestId(`column-${doing.id}`));
    expect(firstColumn.x, 'first column x on a phone').toBe(12);
    expect(firstColumn.right, 'first column ends at 300').toBe(300);
    expect(secondColumn.x, 'the second column peeks into view').toBe(316);
    expect(secondColumn.x).toBeLessThan(390);

    // The bar is two rows — 48 with the name and the gear, 40 with the meta
    // and the filters — closed by a single hairline.
    expect((await box(page.getByTestId('board-bar-row1'))).height, 'bar row 1 height').toBe(48);
    expect((await box(page.getByTestId('board-bar-row2'))).height, 'bar row 2 height').toBe(40);
  });
});
