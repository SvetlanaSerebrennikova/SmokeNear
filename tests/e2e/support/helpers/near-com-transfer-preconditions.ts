import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { assertNearComWalletSessionReady } from './near-com-my-address-modal';

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
 * Same baseline as WC connect / `trade/01`: app origin is open and Account menu is available
 * (near.com no longer reliably shows the EVM address in header).
 */
export async function transferFlowPreconditionsNearComSignedIn(
  page: Page,
  _evmAddress: `0x${string}`
): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await assertNearComWalletSessionReady(page);
}
