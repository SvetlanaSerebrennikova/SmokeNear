/**
 * Guest validation: /login routing, auth rails, and Web3 / EVM picker exposes WalletConnect.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  nearComAuthMethodPatterns,
  nearComWalletOptionPatterns,
  walletOptionByPattern,
  nearComEvmWalletsOpener,
  signInEntrypoint,
  walletConnectLoginOption,
} from '../../support/locators/near-com.locators';

async function openWalletProviderRailNearLogin(page: Page): Promise<void> {
  const evm = nearComEvmWalletsOpener(page).first();
  await expect(evm).toBeVisible({ timeout: 60_000 });
  await evm.click();
  await page.waitForTimeout(700);
}

test.describe('near.com / sign-in routing (guest)', () => {
  test('Sign in from home navigates to /login', async ({ page }) => {
    await page.goto('/');
    const signIn = signInEntrypoint(page);
    await signIn.click();
    await expect(page).toHaveURL(/\/login/i);
  });
});

test.describe('near.com / login screen (guest)', () => {
  test('/login lists auth rails and Web3 provider rows', async ({ page }) => {
    await page.goto('/login');
    for (const pattern of nearComAuthMethodPatterns) {
      await expect(walletOptionByPattern(page, pattern)).toBeVisible();
    }
    await expect(nearComEvmWalletsOpener(page).first()).toBeVisible({ timeout: 20_000 });
    await openWalletProviderRailNearLogin(page);
    await expect(walletConnectLoginOption(page)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('near.com / Web3 picker (guest)', () => {
  test('EVM wallets rail opens and shows WalletConnect', async ({ page }) => {
    await page.goto('/login');
    await openWalletProviderRailNearLogin(page);
    await expect(walletConnectLoginOption(page)).toBeVisible({ timeout: 30_000 });

    for (const pattern of nearComWalletOptionPatterns) {
      const locator = walletOptionByPattern(page, pattern);
      if ((await locator.count()) > 0) {
        await expect(locator.first()).toBeVisible({ timeout: 15_000 });
      }
    }
  });

  test('EVM wallets row alone still reaches WalletConnect entry', async ({ page }) => {
    await page.goto('/login');
    const evmRail = nearComEvmWalletsOpener(page).first();
    await expect(evmRail).toBeVisible({ timeout: 30_000 });
    await evmRail.click();
    await expect(walletConnectLoginOption(page)).toBeVisible({ timeout: 20_000 });
  });
});
