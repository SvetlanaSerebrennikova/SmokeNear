/**
 * Guest: unauthenticated visit to /swap — we only assert what the live app does after navigation settles.
 * If the tab never leaves /swap, or /login loads with an empty shell, this test fails (that is the honest signal).
 */
import { expect, test } from '@playwright/test';

test.describe('near.com / swap as guest', () => {
  test('/swap should end on /login when redirect completes', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', msg => errors.push(msg.message));

    await page.goto('/swap', { waitUntil: 'domcontentloaded', timeout: 60_000 });

    await expect(page, 'guest /swap is expected to navigate to /login (otherwise the router is stuck on /swap)').toHaveURL(
      /\/login/i,
      { timeout: 30_000 }
    );

    const url = new URL(page.url());
    const redirectRaw = url.searchParams.get('redirect');
    expect(redirectRaw, 'when /login opens from /swap, expect redirect= carrying the return path').toBeTruthy();
    const redirectPath = decodeURIComponent(redirectRaw!);
    expect(redirectPath).toMatch(/^\/?swap\/?$/i);

    await expect(
      page.getByRole('heading', { name: /sign\s*in/i }),
      'if URL is /login but the document never paints, this fails (blank / frozen shell)'
    ).toBeVisible({ timeout: 30_000 });

    expect(errors, 'no uncaught page errors').toEqual([]);
  });
});

test.describe('near.com / trade guest 404', () => {
  test('/trade returns not-found for guests', async ({ page }) => {
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /this page does not exist/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: /back\s*to\s*home/i }).first()).toBeVisible();
  });
});
