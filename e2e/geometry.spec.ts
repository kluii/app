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
 *
 * Phase 6b (the other screens) adds the shell — 56 px, a 24 px wordmark, no
 * hairline of its own on a board route — and the boards grid: four tiles on one
 * row, equal heights.
 */
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { PASSWORD, openBoard, post, uniqueUsername } from './support';

test.use({ viewport: { width: 1440, height: 900 } });

type Box = { x: number; y: number; width: number; height: number; right: number; bottom: number };

async function box(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const { x, y, width, height, right, bottom } = rect;
    return { x, y, width, height, right, bottom };
  });
}

/** A signed-in browser whose session lives in the API context's cookies. */
async function signedIn(page: Page, request: APIRequestContext, username: string): Promise<void> {
  await request.post('/api/v1/auth/signup', {
    data: { email: `${username}@klui.test`, username, password: PASSWORD },
  });
  await page.context().addCookies((await request.storageState()).cookies);
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

test.describe('the shell', () => {
  test('is 56 px tall with a 24 px wordmark, and rules itself once', async ({ page, request }) => {
    await signedIn(page, request, uniqueUsername('geometry-shell'));
    await page.goto('/boards', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Boards' })).toBeVisible();

    const header = page.locator('header[data-app-chrome="true"]');
    expect((await box(header)).height, 'header height').toBe(56);
    expect((await box(header.locator('img'))).height, 'wordmark height').toBe(24);
    const geometry = await header.evaluate((element) => {
      const style = getComputedStyle(element);
      return { left: style.paddingLeft, right: style.paddingRight, rule: style.borderBottomWidth };
    });
    expect(geometry.left, 'header padding left').toBe('24px');
    expect(geometry.right, 'header padding right').toBe('24px');
    expect(geometry.rule, 'header hairline off the board').toBe('1px');
  });

  test('leaves the hairline to the board bar on a board route', async ({ page, request }) => {
    await openBoard(page, request, uniqueUsername('geometry-shell-board'), ['Alpha']);

    const rule = await page
      .locator('header[data-app-chrome="true"]')
      .evaluate((element) => getComputedStyle(element).borderBottomWidth);
    expect(rule, 'no second hairline above the board bar').toBe('0px');
    // The one rule on the page is the bar's own.
    expect(
      await page
        .getByTestId('board-bar')
        .evaluate((element) => getComputedStyle(element).borderBottomWidth),
    ).toBe('1px');
  });
});

test('four boards are four tiles on one row, all the same height', async ({ page, request }) => {
  await signedIn(page, request, uniqueUsername('geometry-grid'));
  for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta']) {
    await post(request, '/api/v1/boards', { name });
  }

  await page.goto('/boards', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Boards' })).toBeVisible();

  const tiles = page.locator('[data-testid^="board-"]');
  await expect(tiles).toHaveCount(4);
  const boxes = await Promise.all(Array.from({ length: 4 }, (_, index) => box(tiles.nth(index))));

  const [first, second, , last] = boxes;
  if (!first || !second || !last) throw new Error('expected four tiles');

  // One row: one y, one height, and 16 between two neighbours.
  expect(new Set(boxes.map((tile) => tile.y)).size, 'tiles share one row').toBe(1);
  expect(new Set(boxes.map((tile) => tile.height)).size, 'tiles share one height').toBe(1);
  expect(first.height, 'tile height').toBe(96);
  expect(second.x - first.right, 'gap between two tiles').toBe(16);
  expect(last.right - first.x, 'four tiles fit the content width').toBe(1392);
});

/**
 * Phase 8 — the plate (brief §8). The plate is the app's one signature
 * surface: a card being held (here, lifted with Space) and the auth mat from
 * 1024 px. At most one rendered element on screen carries `--plate` as its
 * computed background. The count runs in the dark theme, where `--plate` is a
 * colour no other token shares; in the light theme the plate is the inverted
 * ink and collides with `--primary` by design.
 */
test.describe('phase 8 — the plate', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /** The computed `--plate` colour in the page's current theme. */
  async function plateColour(page: Page): Promise<string> {
    return page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--plate)';
      document.body.appendChild(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    });
  }

  /** How many rendered elements on the page are painted with `--plate`. */
  async function plateCount(page: Page): Promise<number> {
    const plate = await plateColour(page);
    return page.evaluate(
      (target) =>
        [...document.querySelectorAll('*')].filter(
          (element) =>
            element.getClientRects().length > 0 &&
            getComputedStyle(element).backgroundColor === target,
        ).length,
      plate,
    );
  }

  for (const theme of ['dark', 'light'] as const) {
    test(`a card lifted with Space is printed on the plate in ${theme}, and Esc restores it`, async ({
      page,
      request,
    }) => {
      await page.addInitScript((value) => {
        localStorage.setItem('klui-theme', value);
      }, theme);
      const { cards } = await openBoard(page, request, uniqueUsername(`plate-lift-${theme}`));
      const [alpha] = cards;
      if (!alpha) throw new Error('seed failed');

      const card = page.getByTestId(`card-${alpha.id}`);
      await card.focus();
      await page.keyboard.press('Space');

      // Exactly one plate: the lifted card's own surface. The card's
      // background transitions over 140 ms, so poll until it settles.
      const plate = page.locator('.card-plate');
      await expect(plate, 'one held card on the plate').toHaveCount(1);
      await expect
        .poll(() => plate.evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe(theme === 'dark' ? 'rgb(233, 229, 221)' : 'rgb(20, 18, 15)');
      expect(await plate.evaluate((el) => getComputedStyle(el).color), 'lifted card ink').toBe(
        theme === 'dark' ? 'rgb(20, 18, 15)' : 'rgb(245, 245, 245)',
      );

      await page.keyboard.press('Escape');
      await expect(page.locator('.card-plate'), 'the plate is gone after Esc').toHaveCount(0);
      // The background transitions back over 140 ms; poll until it settles.
      await expect
        .poll(() =>
          card.locator('..').evaluate((row) => {
            const body = row.firstElementChild;
            if (!(body instanceof HTMLElement)) throw new Error('the card has no body');
            return getComputedStyle(body).backgroundColor;
          }),
        )
        .toBe(theme === 'dark' ? 'rgb(30, 30, 31)' : 'rgb(255, 255, 255)');

      if (theme === 'dark') {
        // No plate at rest on the board, exactly one during the lift.
        expect(await plateCount(page), 'plates at rest on the board').toBe(0);
        await card.focus();
        await page.keyboard.press('Space');
        await expect.poll(() => plateCount(page), 'plate-painted elements during the lift').toBe(1);
        await page.keyboard.press('Escape');
        await expect.poll(() => plateCount(page), 'plates after Esc').toBe(0);
      }
    });
  }

  test('the auth page carries exactly one plate at 1280 px', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('klui-theme', 'dark');
    });
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    const plate = page.getByTestId('auth-plate');
    await expect(plate, 'the plate is rendered from 1024 px').toBeVisible();

    expect(await plateCount(page), 'plate-painted elements on /login at 1280').toBe(1);
    expect(await plate.getAttribute('aria-hidden'), 'the mock is hidden from AT').toBe('true');
    const focusable = await plate.evaluate(
      (element) =>
        element.querySelectorAll('a, button, input, select, textarea, summary, [tabindex]').length,
    );
    expect(focusable, 'focusable descendants inside the plate').toBe(0);
    const styles = await plate.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        radius: style.borderRadius,
        shadow: style.boxShadow,
        transform: style.transform,
      };
    });
    expect(styles.radius, 'the mat is printed flat at 8 px').toBe('8px');
    expect(styles.shadow, 'no shadow on the mat').toBe('none');
    expect(styles.transform, 'no rotation on the mat').toBe('none');
  });

  test('the auth page renders no plate at 1023 px', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('klui-theme', 'dark');
    });
    await page.setViewportSize({ width: 1023, height: 800 });
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('auth-plate'), 'no plate below 1024 px').toBeHidden();
    expect(await plateCount(page), 'plate-painted elements on /login at 1023').toBe(0);
  });
});
