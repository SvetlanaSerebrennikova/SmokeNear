/**
 * Guest validation: home loads without uncaught errors and exposes sign-in entry.
 */
import { expect, test } from '@playwright/test';
import { nearComHomeTitle, signInEntrypoint } from '../../support/locators/near-com.locators';

test.describe('near.com / homepage (guest)', () => {
  test('document title matches marketing shell', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveTitle(nearComHomeTitle);
    expect(errors).toEqual([]);
  });

  test('sign-in entrypoint is visible', async ({ page }) => {
    await page.goto('/');
    const signIn = signInEntrypoint(page);
    await expect(signIn.first()).toBeVisible();
  });
});
