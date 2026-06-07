import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { requireWalletConnectEnv } from '../../support/guards/walletconnect-env';
import { closeExtraContextPages } from '../../support/helpers/browser-context-cleanup';
import { connectNearComWithWalletConnect } from '../../support/helpers/near-walletconnect-session';

function appOrigin(): string {
  return new URL(process.env.APP_URL ?? 'https://near.com').origin;
}

type WalletWorkerFixtures = {
  wcContext: BrowserContext;
  wcPage: Page;
  wcBridge: Awaited<ReturnType<typeof connectNearComWithWalletConnect>>;
};

/**
 * One browser context + one WC bridge per Playwright worker so split spec files still share a session.
 * Run these specs with project `near-wallet-serial` (`workers: 1`, `fullyParallel: false`).
 */
export const test = base.extend<object, WalletWorkerFixtures>({
  wcContext: [
    async ({ browser }, use) => {
      const ctx = await browser.newContext();
      await use(ctx);
      const pages = ctx.pages();
      const keep = pages[0];
      if (keep) await closeExtraContextPages(ctx, keep);
      await ctx.close().catch(() => undefined);
    },
    { scope: 'worker', timeout: 420_000 },
  ],
  wcPage: [
    async ({ wcContext }, use) => {
      const p = await wcContext.newPage();
      await use(p);
      await p.close().catch(() => undefined);
    },
    { scope: 'worker' },
  ],
  wcBridge: [
    async ({ wcPage, wcContext }, use) => {
      const wc = requireWalletConnectEnv();
      const bridge = await connectNearComWithWalletConnect(wcPage, wcContext, {
        ...wc,
        appOrigin: appOrigin(),
        entry: 'home-sign-in',
      });
      await use(bridge);
      await bridge.close().catch(() => undefined);
    },
    { scope: 'worker', timeout: 420_000 },
  ],
});

export { expect };

let confidentialDepositSucceeded = false;

export function resetConfidentialDepositFlag(): void {
  confidentialDepositSucceeded = false;
}

export function markConfidentialDepositSucceeded(ok: boolean): void {
  confidentialDepositSucceeded = ok;
}

export function confidentialDepositFinishedOk(): boolean {
  return confidentialDepositSucceeded;
}
