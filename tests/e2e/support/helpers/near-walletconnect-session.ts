import { expect, type Locator } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { assertNearComWalletSessionReady } from './near-com-my-address-modal';
import {
  nearComBrowserWalletRailOpener,
  nearComEvmWalletsOpener,
  signInEntrypoint,
  walletConnectLoginOption,
} from '../locators/near-com.locators';
import { createWalletConnectTestBridge } from './walletconnect-wallet-bridge';
import { readWalletConnectUriFromPage } from './walletconnect-uri';
import { dismissVerifyWalletModalIfPresent } from './near-verify-wallet-modal';
import { transferFlowPreconditionsNearComSignedIn } from './near-com-transfer-preconditions';

export type NearWalletConnectSessionOptions = {
  projectId: string;
  evmPrivateKey: `0x${string}`;
  /** Needed when proposal requires `near:` namespace */
  nearAccountId?: string;
  appOrigin: string;
  /**
   * `'home-sign-in'`: `/` → assert Sign in → click → `/login` → EVM wallets → WC (single tab, human-like).
   * `'direct-login'`: open `/login` immediately (default).
   */
  entry?: 'direct-login' | 'home-sign-in';
};

const walletConnectLabel = /\bwallet\s*connect\b|walletconnect|web3\s*wallet\s*connect|web3\s*walletconnect|^wc\b/i;

function walletConnectTiles(page: Page, scope: 'page' | 'dialog' = 'page') {
  const dialog = page.getByRole('dialog');
  const root = scope === 'dialog' ? dialog : page;
  const scoped = root
    .locator('[data-testid="wallet-tile-walletconnect"]')
    .or(root.getByRole('button', { name: walletConnectLabel }))
    .or(root.getByRole('link', { name: walletConnectLabel }))
    .or(root.locator('button').filter({ hasText: walletConnectLabel }));
  if (scope === 'page') {
    return scoped.or(walletConnectLoginOption(page));
  }
  return scoped;
}

async function pickVisibleWalletConnectTile(
  page: Page,
  scope: 'page' | 'dialog' = 'page'
): Promise<Locator> {
  const candidates = walletConnectTiles(page, scope);
  const count = await candidates.count();
  for (let i = 0; i < count; i++) {
    const tile = candidates.nth(i);
    if (await walletConnectTileIsActionable(tile)) return tile;
  }
  for (let i = 0; i < count; i++) {
    const tile = candidates.nth(i);
    if (await tile.isVisible().catch(() => false)) return tile;
  }
  return scope === 'dialog'
    ? walletConnectTiles(page, 'dialog').first()
    : walletConnectLoginOption(page);
}

async function walletConnectTileIsActionable(tile: Locator): Promise<boolean> {
  if (!(await tile.isVisible().catch(() => false))) return false;
  if (await tile.isDisabled().catch(() => false)) return false;
  if ((await tile.getAttribute('aria-disabled')) === 'true') return false;
  const cls = (await tile.getAttribute('class')) ?? '';
  if (/\bcursor-not-allowed\b/.test(cls)) return false;
  return true;
}

/** Wait until near.com / Reown enables the WalletConnect tile (CI often starts disabled ~1–30s). */
async function waitForEnabledWalletConnectTile(
  page: Page,
  scope: 'page' | 'dialog' = 'page',
  timeoutMs = 90_000
): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tile = await pickVisibleWalletConnectTile(page, scope);
    if (await walletConnectTileIsActionable(tile)) return tile;
    await page.waitForTimeout(400);
  }
  return pickVisibleWalletConnectTile(page, scope);
}

async function clickEnabledWalletConnectTile(
  page: Page,
  scope: 'page' | 'dialog',
  opts?: { refreshRailOnStuck?: boolean; timeoutMs?: number }
): Promise<void> {
  const refreshRailOnStuck = opts?.refreshRailOnStuck !== false;
  const timeoutMs = opts?.timeoutMs ?? 90_000;

  for (let attempt = 0; attempt < 2; attempt++) {
    const tile = await waitForEnabledWalletConnectTile(
      page,
      scope,
      attempt === 0 ? timeoutMs : Math.min(timeoutMs, 45_000)
    );
    await tile.scrollIntoViewIfNeeded().catch(() => undefined);

    try {
      await expect(tile).toBeEnabled({ timeout: 5_000 });
      await tile.click({ timeout: 15_000 });
      return;
    } catch {
      if (await walletConnectTileIsActionable(tile)) {
        await tile.click({ timeout: 15_000 });
        return;
      }
    }

    if (attempt === 0 && refreshRailOnStuck && scope === 'page') {
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(400);
      await revealWcProviderListNearLogin(page);
      continue;
    }

    await tile.click({ force: true, timeout: 15_000 });
    return;
  }
}

async function clickWalletConnectTile(page: Page): Promise<void> {
  await clickEnabledWalletConnectTile(page, 'page');
}

async function revealWcProviderListNearLogin(page: Page): Promise<void> {
  const evm = nearComEvmWalletsOpener(page).first();
  try {
    await expect(evm).toBeVisible({ timeout: 60_000 });
    await evm.click();
    await page.waitForTimeout(700);
    return;
  } catch {
    /* Legacy layouts only expose “Web3 browser wallet”; don’t burn 2m on a missing EVM row. */
  }

  const browser = nearComBrowserWalletRailOpener(page).first();
  await expect(browser).toBeVisible({ timeout: 35_000 });
  await browser.click();
  await page.waitForTimeout(700);
}

/** Reown / AppKit modal often nests a second tap on “WalletConnect” before QR / pairing URI renders. */
async function maybeClickWalletConnectInModal(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  if (!(await dialog.isVisible({ timeout: 2000 }).catch(() => false))) return;

  const modalTile = walletConnectTiles(page, 'dialog').first();
  if (!(await modalTile.isVisible({ timeout: 8000 }).catch(() => false))) return;

  await clickEnabledWalletConnectTile(page, 'dialog', {
    refreshRailOnStuck: false,
    timeoutMs: 60_000,
  });
}

export async function connectNearComWithWalletConnect(
  page: Page,
  context: BrowserContext,
  opts: NearWalletConnectSessionOptions
) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: opts.appOrigin,
  });

  const bridge = await createWalletConnectTestBridge({
    projectId: opts.projectId,
    evmPrivateKey: opts.evmPrivateKey,
    nearAccountId: opts.nearAccountId,
  });

  const entry = opts.entry ?? 'direct-login';
  if (entry === 'home-sign-in') {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const signIn = signInEntrypoint(page);
    await expect(signIn.first()).toBeVisible({ timeout: 30_000 });
    await signIn.first().click();
    await expect(page).toHaveURL(/\/login/i, { timeout: 45_000 });
    await page.waitForLoadState('domcontentloaded');
  } else {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login/i);
  }

  await revealWcProviderListNearLogin(page);

  await clickWalletConnectTile(page);
  await maybeClickWalletConnectInModal(page);

  const uri = await readWalletConnectUriFromPage(page, 120_000);
  await bridge.pair(uri);
  await page.waitForTimeout(3000);
  await dismissVerifyWalletModalIfPresent(page);

  await assertNearComWalletSessionReady(page);

  return bridge;
}

export type WalletConnectPairingBridge = {
  readonly evmAddress: `0x${string}`;
  pair(uri: string): Promise<void>;
};

/** Re-pair an existing headless WC bridge when near.com drops the EVM session. */
export async function reconnectNearComWalletConnect(
  page: Page,
  bridge: WalletConnectPairingBridge
): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await revealWcProviderListNearLogin(page);

  await clickWalletConnectTile(page);
  await maybeClickWalletConnectInModal(page);

  const uri = await readWalletConnectUriFromPage(page, 120_000);
  await bridge.pair(uri);
  await page.waitForTimeout(3000);
  await dismissVerifyWalletModalIfPresent(page);

  await assertNearComWalletSessionReady(page);
}

/**
 * Signed-in home session, then open /swap authenticated.
 * On /login redirect, re-pair WC once and retry.
 */
export async function gotoAuthenticatedSwap(
  page: Page,
  bridge: WalletConnectPairingBridge
): Promise<void> {
  await transferFlowPreconditionsNearComSignedIn(page, bridge.evmAddress);

  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto('/swap', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    if (!/\/login/i.test(page.url())) {
      await expect(page).toHaveURL(/\/swap(?:\/|$|\?)/i);
      await assertNearComWalletSessionReady(page);
      return;
    }

    if (attempt === 0) {
      await reconnectNearComWalletConnect(page, bridge);
      await transferFlowPreconditionsNearComSignedIn(page, bridge.evmAddress);
    }
  }

  await expect(page).not.toHaveURL(/\/login/i);
  await expect(page).toHaveURL(/\/swap(?:\/|$|\?)/i);
}
