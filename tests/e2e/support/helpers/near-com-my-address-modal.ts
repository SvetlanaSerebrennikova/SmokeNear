import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  nearComAccountMenuOpener,
  nearComInternalAddressModal,
  nearComInternalAddressModalHeading,
  nearComInternalAddressShownLine,
  nearComMyAddressMenuItem,
  uiTextShowsEthConnection,
} from '../locators/near-com.account.locators';

/** WC paired: home loads and Account menu is available (no full My Address flow). */
export async function assertNearComWalletSessionReady(page: Page): Promise<void> {
  if (/\/login(?:\?|$)/i.test(page.url())) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }
  await expect(page).not.toHaveURL(/\/login/i);
  await expect(nearComAccountMenuOpener(page)).toBeVisible({ timeout: 90_000 });
}

/**
 * Account → My address → consent checkbox → Show address → compare shortened UI line
 * with the WalletConnect-connected EVM address.
 */
export async function assertConnectedEvmAddressViaMyAddressModal(
  page: Page,
  connectedAddress: `0x${string}`
): Promise<void> {
  if (/\/login(?:\?|$)/i.test(page.url())) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  const account = nearComAccountMenuOpener(page);
  await expect(account).toBeVisible({ timeout: 90_000 });
  await account.click();

  const myAddress = nearComMyAddressMenuItem(page);
  await expect(myAddress).toBeVisible({ timeout: 30_000 });
  await myAddress.click();

  const modal = nearComInternalAddressModal(page);
  await expect(modal).toBeVisible({ timeout: 30_000 });

  const heading = nearComInternalAddressModalHeading(page);
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText(/(?:this\s+is\s+)?your\s+internal\s+near\.com\s+address/i);

  const checkbox = modal.getByRole('checkbox').first();
  await expect(checkbox).toBeVisible({ timeout: 15_000 });

  const showAddress = modal.getByRole('button', { name: /show\s+address/i });
  await expect(showAddress).toBeVisible();
  await expect(showAddress).toBeDisabled();

  await checkbox.check();
  await expect(showAddress).toBeEnabled({ timeout: 15_000 });
  await showAddress.click();

  const addressLine = nearComInternalAddressShownLine(modal);
  await expect(addressLine).toBeVisible({ timeout: 15_000 });
  expect(uiTextShowsEthConnection(await addressLine.textContent(), connectedAddress)).toBe(true);

  await page.keyboard.press('Escape').catch(() => undefined);
}
