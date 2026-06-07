import type { Page } from '@playwright/test';

// near.com title can change with marketing copy; keep it permissive.
export const nearComHomeTitle = /defi hub|near/i;

export function signInEntrypoint(page: Page) {
  return page.getByRole('link', { name: /sign in/i }).or(
    page.getByRole('button', { name: /sign in/i })
  );
}

export const nearComAuthMethodPatterns = [
  /passkey/i,
] as const;

export const nearComWalletOptionPatterns = [
  /web3\s*near/i,
  /web3\s*binance web3/i,
  /web3\s*browser wallet/i,
  /web3\s*solana/i,
  /web3\s*walletconnect/i,
  /web3\s*ton/i,
  /web3\s*stellar/i,
  /web3\s*tron/i,
  /web3\s*coinbase wallet/i,
] as const;

export function walletOptionByPattern(page: Page, pattern: RegExp) {
  return page.getByRole('button', { name: pattern });
}

/**
 * After opening EVM / browser-wallet rail near.com lists connect methods.
 * Accessible name is often "**Wallet Connect**", not "**Web3 WalletConnect**".
 */
export function walletConnectLoginOption(page: Page) {
  const name =
    /\bwallet\s*connect\b|walletconnect|web3\s*wallet\s*connect|web3\s*walletconnect|^wc\b/i;
  return page
    .getByRole('button', { name })
    .or(page.getByRole('link', { name }))
    .or(page.getByRole('option', { name }))
    .or(page.getByRole('menuitem', { name }))
    /** Card-style rows mis-tagged outside WAI landmarks */
    .or(page.locator('[role="listbox"] button, [role="list"] button').filter({ hasText: name }))
    .first();
}

/** Fallback panel that lists EVM-ish providers including WalletConnect */
export function nearComBrowserWalletRailOpener(page: Page) {
  return walletOptionByPattern(page, /web3\s*browser wallet/i);
}

/**
 * near.com nests WalletConnect behind the EVM wallets rail first.
 * Copy shifts; match common variants (`web3 EVM wallets`, `EVM wallets`, etc.).
 */
export const nearComEvmWalletsButtonPattern =
  /web3\s*(evm\s*)?wallets|evm\s*wallets|web3\s*ethereum|web3\s*evm\b/i;

export function nearComEvmWalletsOpener(page: Page) {
  const p = nearComEvmWalletsButtonPattern;
  return page.getByRole('button', { name: p }).or(page.getByRole('link', { name: p }));
}

export function allWeb3WalletOptionButtons(page: Page) {
  return page.getByRole('button', { name: /web3\s+/i });
}

/** Shell Move → confidential **unshield** (withdraw to Main); `href` с `unshield` / `mode=unshield`. */
export function nearComConfidentialUnshieldMoveLink(page: Page) {
  return page.locator(
    [
      'a[href="/transfer?mode=unshield"]',
      'a[href*="transfer?mode=unshield"]',
      'a[href="/transfer/confidential?mode=unshield"]',
      'a[href*="transfer/confidential?mode=unshield"]',
      'a[href*="transfer/confidential"][href*="unshield"]',
    ].join(', ')
  );
}

/** Shield deposit rail (`mode=shield`). Kept next to unshield for symmetry. */
export function nearComConfidentialShieldMoveLink(page: Page) {
  return page.locator(
    [
      'a[href="/transfer?mode=shield"]',
      'a[href*="transfer?mode=shield"]',
      'a[href="/transfer/confidential?mode=shield"]',
      'a[href*="transfer/confidential?mode=shield"]',
      'a[href*="transfer/confidential"][href*="shield"]',
    ].join(', ')
  );
}

/** Segmented rail on `/transfer/confidential`: **To Main** (Confidential → Main). */
export function nearComConfidentialToMainTab(page: Page) {
  const label = /\bto\s+main\b/i;
  return page
    .getByRole('tab', { name: label })
    .or(page.getByRole('button', { name: label }))
    .or(page.locator('main').locator('[role="tab"], button[type="button"]').filter({ hasText: label }))
    .or(page.locator('main').locator('a').filter({ hasText: label }));
}

/**
 * Shield transfer success card: `<button type="button">` with visible label **Move again**
 * (icon is decorative; accessible name is “Move again”).
 */
export function nearComMoveAgainCta(page: Page) {
  const exact = /^Move again$/i;
  const loose = /move\s*(it\s*)?again/i;
  return page
    .locator('main')
    .getByRole('button', { name: exact })
    .or(page.getByRole('button', { name: exact }))
    .or(page.locator('main').getByRole('button', { name: loose }))
    .or(page.getByRole('link', { name: loose }))
    .or(page.locator('main').locator('button[type="button"]').filter({ hasText: loose }))
    .or(page.getByRole('dialog').getByRole('button', { name: exact }))
    .or(page.getByRole('dialog').getByRole('button', { name: loose }));
}

/** Home: “Move” entry (transfers / rail hub; role may be link or tab). */
export function nearComHomeMoveNav(page: Page) {
  const move = /^move$/i;
  return page.getByRole('link', { name: move }).or(page.getByRole('tab', { name: move }));
}

