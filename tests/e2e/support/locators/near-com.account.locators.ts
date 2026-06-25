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

/** Parse `0xabc…def` / `0xabc...def` / `0xabc---def` shortened forms from near.com My Address modal. */
export function parseShortenedEthAddress(
  uiText: string | null
): { prefix: string; suffix: string } | null {
  if (!uiText) return null;
  const m = uiText.trim().match(/^0x([0-9a-f]{3,12})([^0-9a-f]{1,12})([0-9a-f]{4,12})$/i);
  if (!m) return null;
  const middle = m[2];
  if (!/[.\s…⋯\-–—]/.test(middle)) return null;
  return { prefix: m[1].toLowerCase(), suffix: m[3].toLowerCase() };
}

/** True when UI copy contains the same address (full or canonical shortened form). */
export function uiTextShowsEthConnection(uiText: string | null, canonical: `0x${string}`): boolean {
  if (!uiText) return false;
  const body = canonical.toLowerCase().replace(/^0x/, '');
  const low = uiText.toLowerCase();
  if (low.includes(body) || low.includes(canonical.toLowerCase())) return true;
  if (nearComEthAddressTextPattern(canonical).test(uiText)) return true;

  const shortened = parseShortenedEthAddress(uiText);
  if (!shortened) return false;
  return body.startsWith(shortened.prefix) && body.endsWith(shortened.suffix);
}

/** Account menu opener in top chrome after sign-in. */
export function nearComAccountMenuOpener(page: Page): Locator {
  const chrome = nearComTopChromeRegion(page);
  return chrome
    .getByRole('button', { name: /^account$/i })
    .or(chrome.getByRole('link', { name: /^account$/i }))
    .or(page.getByRole('button', { name: /^account$/i }))
    .or(page.getByRole('link', { name: /^account$/i }))
    .first();
}

/** Account dropdown → “My address”. */
export function nearComMyAddressMenuItem(page: Page): Locator {
  return page
    .getByRole('menuitem', { name: /my\s+address/i })
    .or(page.getByRole('button', { name: /my\s+address/i }))
    .or(page.getByRole('link', { name: /my\s+address/i }))
    .or(page.getByText(/^my\s+address$/i))
    .first();
}

/** Modal: “Your / This is your internal near.com address”. */
export function nearComInternalAddressModal(page: Page): Locator {
  const heading = /(?:this\s+is\s+)?your\s+internal\s+near\.com\s+address/i;
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: heading }) });
}

export function nearComInternalAddressModalHeading(page: Page): Locator {
  return nearComInternalAddressModal(page).getByRole('heading', {
    name: /(?:this\s+is\s+)?your\s+internal\s+near\.com\s+address/i,
  });
}

/** Shortened EVM line directly under the modal title (visible after “Show address”). */
export function nearComInternalAddressShownLine(modal: Locator): Locator {
  const title = modal.getByRole('heading', {
    name: /your\s+internal\s+near\.com\s+address/i,
  });
  return title
    .locator('xpath=following-sibling::div[1]')
    .filter({ hasText: /^0x/i })
    .first();
}
