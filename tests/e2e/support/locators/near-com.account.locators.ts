import type { Locator, Page } from '@playwright/test';

/**
 * Top chrome after auth — near.com usually prints the wallet in header / banner roles.
 */
export function nearComTopChromeRegion(page: Page): Locator {
  return page.locator('header, [role="banner"]').first();
}

/**
 * Matches shortened (`0xabcd…cdef`), middle-ellipsis, or full canonical EVM addresses.
 * near.com sometimes shows a very short prefix after `0x`.
 */
export function nearComEthAddressTextPattern(address0x: `0x${string}`): RegExp {
  const body = address0x.toLowerCase().replace(/^0x/, '');
  const end = body.slice(-4);
  const s6 = body.slice(0, 6);
  const s4 = body.slice(0, 4);
  const s3 = body.slice(0, 3);
  const gap = String.raw`(?:[\s,.]*(?:\.{2,3}|…|⋯)[\s,.]*|[\s…⋯]*)`;
  return new RegExp(
    `(^0x${body}$)|(0x${s6}${gap}${end})|(0x${s4}${gap}${end})|(0x${s3}${gap}${end})`,
    'i'
  );
}

/**
 * Connected-account chip: search header first, then whole document (modal may relocate text).
 */
export function nearComEthAccountIndicator(page: Page, connectedAddress: `0x${string}`): Locator {
  const re = nearComEthAddressTextPattern(connectedAddress);
  return nearComTopChromeRegion(page)
    .getByText(re)
    .first()
    .or(page.getByText(re).first());
}

/** True when UI copy contains the same address (full or canonical shortened form). */
export function uiTextShowsEthConnection(uiText: string | null, canonical: `0x${string}`): boolean {
  if (!uiText) return false;
  const low = canonical.toLowerCase();
  if (uiText.toLowerCase().includes(low)) return true;
  return nearComEthAddressTextPattern(canonical).test(uiText);
}
