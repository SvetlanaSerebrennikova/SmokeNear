import { expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import {
  nearComEthAccountIndicator,
  uiTextShowsEthConnection,
} from '../locators/near-com.account.locators';
import {
  nearComBrowserWalletRailOpener,
  nearComEvmWalletsOpener,
  signInEntrypoint,
  walletConnectLoginOption,
} from '../locators/near-com.locators';
import { createWalletConnectTestBridge } from './walletconnect-wallet-bridge';
import { readWalletConnectUriFromPage } from './walletconnect-uri';
import { dismissVerifyWalletModalIfPresent } from './near-verify-wallet-modal';

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
  await page.waitForTimeout(350);
  const label = /\bwallet\s*connect\b|walletconnect/i;
  const scoped = dialog
    .getByRole('button', { name: label })
    .or(dialog.locator('button').filter({ hasText: label }))
    .first();
  await scoped.click({ timeout: 8000 }).catch(() => undefined);
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

  const wcEntry = walletConnectLoginOption(page);
  await expect(wcEntry).toBeVisible({
    timeout: 90_000,
  });
  await wcEntry.click();
  await maybeClickWalletConnectInModal(page);

  const uri = await readWalletConnectUriFromPage(page, 120_000);
  await bridge.pair(uri);
  await page.waitForTimeout(3000);
  await dismissVerifyWalletModalIfPresent(page);

  const indicator = nearComEthAccountIndicator(page, bridge.evmAddress);
  await expect(indicator).toBeVisible({ timeout: 120_000 });
  expect(uiTextShowsEthConnection(await indicator.textContent(), bridge.evmAddress)).toBe(true);

  return bridge;
}
