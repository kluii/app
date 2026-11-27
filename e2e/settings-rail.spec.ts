// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The settings rail (v2.1).
 *
 * Four claims, measured: a deep link opens the panel it names and a reload
 * keeps it, only the selected panel is mounted (a section that polls must not
 * run behind another one), the arrow/Home/End contract holds, and at 390 px the
 * rail scrolls sideways while the page itself does not.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PASSWORD, uniqueUsername } from './support';

async function signedIn(page: Page, request: APIRequestContext): Promise<void> {
  const username = uniqueUsername('rail');
  await request.post('/api/v1/auth/signup', {
    data: { email: `${username}@klui.test`, username, password: PASSWORD },
  });
  await page.context().addCookies((await request.storageState()).cookies);
}

test('a ?section= deep link opens that panel, and a reload keeps it', async ({ page, request }) => {
  await signedIn(page, request);

  await page.goto('/settings?section=agents', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('settings-tab-agents')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('settings-panel')).toHaveAttribute('data-section', 'agents');
  await expect(page.getByRole('heading', { level: 2, name: 'Agents' })).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('settings-tab-agents')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('settings-panel')).toHaveAttribute('data-section', 'agents');
});

test('one panel is mounted at a time, and choosing a row moves the URL', async ({
  page,
  request,
}) => {
  await signedIn(page, request);

  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('settings-panel')).toHaveAttribute('data-section', 'profile');
  // Not rendered, not merely hidden: the sessions panel is absent from the DOM.
  await expect(page.getByTestId('session-row')).toHaveCount(0);

  await page.getByTestId('settings-tab-sessions').click();
  await expect(page).toHaveURL(/[?&]section=sessions/u);
  await expect(page.getByTestId('session-row').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Active sessions' })).toBeVisible();
  // The profile form is gone, not sitting off-screen.
  await expect(page.getByLabel('Username')).toHaveCount(0);

  await page.getByTestId('settings-tab-profile').click();
  await expect(page).toHaveURL(/[?&]section=profile/u);
  await expect(page.getByLabel('Username')).toBeVisible();
  await expect(page.getByTestId('session-row')).toHaveCount(0);
});

test('arrows walk the rail, Home and End jump to its ends', async ({ page, request }) => {
  await signedIn(page, request);

  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('settings-tab-profile').focus();

  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('settings-tab-sessions')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('settings-tab-sessions')).toBeFocused();

  await page.keyboard.press('End');
  await expect(page.getByTestId('settings-tab-danger')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('settings-tab-danger')).toBeFocused();
  await expect(page.getByRole('heading', { level: 2, name: 'Delete account' })).toBeVisible();

  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('settings-tab-profile')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('settings-tab-danger')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Home');
  await expect(page.getByTestId('settings-tab-profile')).toHaveAttribute('aria-selected', 'true');
});

test('the rail is a column at 1440 px', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signedIn(page, request);
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });

  const rail = await page.getByTestId('settings-rail').boundingBox();
  if (!rail) throw new Error('no rail');
  expect(rail.height).toBeGreaterThan(rail.width);

  // The page itself never scrolls sideways at either width.
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
});

test('the rail becomes a horizontal strip at 390 px, and only it scrolls', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedIn(page, request);
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });

  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);

  const rail = await page.getByTestId('settings-rail').evaluate((element) => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
    wrap: getComputedStyle(element).flexWrap,
    direction: getComputedStyle(element).flexDirection,
  }));
  expect(rail.scroll).toBeGreaterThan(rail.client);
  expect(rail.wrap).toBe('nowrap');
  expect(rail.direction).toBe('row');

  // A row still selects, and the panel below it keeps the full width.
  await page.getByTestId('settings-tab-sessions').click();
  await expect(page.getByTestId('settings-tab-sessions')).toHaveAttribute('aria-selected', 'true');
  const panel = await page.getByTestId('settings-panel').boundingBox();
  if (!panel) throw new Error('no panel');
  expect(panel.width).toBeGreaterThan(rail.client * 0.9);
});
