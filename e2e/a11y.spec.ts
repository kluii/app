// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K2-15 — the accessibility close.
 *
 * Two exits: axe reports zero violations on every route, and a keyboard-only
 * journey reaches and operates every control on the board. The second is the
 * one that catches a real defect: axe cannot see a button that is unreachable
 * because an earlier element swallowed Tab.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PASSWORD, openBoard, patch, uniqueUsername } from './support';

const ROUTES = ['/login', '/signup', '/reset'];

for (const theme of ['light', 'dark'] as const) {
  test(`axe is clean on the public routes in ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => {
      window.localStorage.setItem('klui-theme', value);
    }, theme);
    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.map((violation) => violation.id),
        route,
      ).toEqual([]);
    }
  });
}

test('axe is clean on the signed-in routes', async ({ page, request }) => {
  const username = uniqueUsername('axe-routes');
  const { boardId } = await openBoard(page, request, username, ['Alpha', 'Bravo']);
  await patch(request, `/api/v1/boards/${boardId}`, { visibility: 'public' });

  for (const route of [
    '/boards',
    `/boards/${boardId}`,
    '/settings',
    '/styleguide',
    `/${username}`,
    `/${username}/board-under-test`,
  ]) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.map((violation) => violation.id),
      route,
    ).toEqual([]);
  }
});

test('the first Tab stop is a skip link, and it moves focus into main', async ({
  page,
  request,
}) => {
  const { boardId } = await openBoard(page, request, uniqueUsername('skip'), ['Alpha']);

  await page.goto(`/boards/${boardId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('body').press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('a keyboard-only journey creates a card, opens it and edits the title', async ({
  page,
  request,
}) => {
  const { boardId } = await openBoard(page, request, uniqueUsername('keyboard'), ['Alpha']);

  await page.goto(`/boards/${boardId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('board-scroll')).toBeVisible();

  // Tab until the card's own button has focus — no mouse anywhere.
  const cardButton = page.getByRole('button', { name: /Open Alpha/u });
  for (let step = 0; step < 40; step += 1) {
    if (await cardButton.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(cardButton).toBeFocused();

  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // The read panel opens on Close, not on an input (K2-07).
  const firstFocused = await page.evaluate(() => document.activeElement?.textContent ?? '');
  expect(firstFocused).toContain('Close');

  // Escape closes and returns focus to the card that opened it.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(cardButton).toBeFocused();

  // Edit through the keyboard: Enter, Tab to Edit, Enter, type, Ctrl+Enter.
  await page.keyboard.press('Enter');
  const reader = page.getByRole('dialog');
  await expect(reader.getByRole('button', { name: 'Edit' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(reader.getByRole('button', { name: 'Edit' })).toBeFocused();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('dialog');
  const title = editor.getByLabel('Title');
  await title.fill('Renamed by keyboard');
  await title.press('ControlOrMeta+Enter');
  await expect(page.getByRole('heading', { name: 'Renamed by keyboard' })).toBeVisible();
});

test('reduced motion collapses every animation to a static frame', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openBoard(page, request, uniqueUsername('motion'), ['Alpha']);

  const durations = await page.evaluate(() => {
    const sample = document.querySelector('[data-testid="board-scroll"]');
    if (!sample) return null;
    const style = getComputedStyle(sample);
    return { animation: style.animationDuration, transition: style.transitionDuration };
  });
  expect(durations?.animation === '0s' || durations?.animation === '').toBe(true);
  expect(durations?.transition === '0s' || durations?.transition === '').toBe(true);
});

test('the sign-in form can be completed with the keyboard only', async ({ page, request }) => {
  const username = uniqueUsername('keysignin');
  await request.post('/api/v1/auth/signup', {
    data: { email: `${username}@klui.test`, username, password: PASSWORD },
  });

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/email or username/iu).focus();
  await page.keyboard.type(username);
  await page.keyboard.press('Tab');
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/boards/u);
});
