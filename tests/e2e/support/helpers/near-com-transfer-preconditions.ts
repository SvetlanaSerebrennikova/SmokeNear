import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { nearComEthAccountIndicator, uiTextShowsEthConnection } from '../locators/near-com.account.locators';

export type NearComConfidentialTransferMode = 'shield' | 'unshield';

/** Canonical entry URLs (legacy `/transfer/confidential?…` redirects to `/transfer?…`). */
export const nearComConfidentialTransferPath: Record<NearComConfidentialTransferMode, string> = {
  shield: '/transfer?mode=shield',
  unshield: '/transfer?mode=unshield',
};

/** Production serves `/transfer?mode=…`; older builds used `/transfer/confidential?mode=…`. */
export function nearComTransferModeUrlPattern(mode: NearComConfidentialTransferMode): RegExp {
  return new RegExp(`/transfer(?:/confidential)?\\?[^#]*mode=${mode}\\b`, 'i');
}

export async function expectNearComTransferModeUrl(
  page: Page,
  mode: NearComConfidentialTransferMode
): Promise<void> {
  await expect(page).not.toHaveURL(/\/login/i);
  await expect(page).toHaveURL(nearComTransferModeUrlPattern(mode));
}

/**
 * Same baseline as the swap wallet chain (`trade/01`): app origin is open and the WC EVM session
 * is visible in chrome — before any transfer-specific navigation (e.g. Move → shield).
 */
export async function transferFlowPreconditionsNearComSignedIn(
  page: Page,
  evmAddress: `0x${string}`
): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/\/login/i);
  const indicator = nearComEthAccountIndicator(page, evmAddress);
  await expect(indicator).toBeVisible({ timeout: 90_000 });
  expect(uiTextShowsEthConnection(await indicator.textContent(), evmAddress)).toBe(true);
}
