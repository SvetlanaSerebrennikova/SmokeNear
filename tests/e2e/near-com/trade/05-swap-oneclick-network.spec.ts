/**
 * Wallet chain — observe 1Click during /swap when proxied in browser; otherwise verify API contract in-process.
 *
 * Opt-in strict mode: `TEST_ONECLICK_BROWSER_NETWORK=1` fails when no browser traffic (no API fallback).
 */
import { expect, test } from '../fixtures/wallet-worker-chain';
import { attachOneClickNetworkRecorder } from '../../support/helpers/oneclick-network-recorder';
import { transferFlowPreconditionsNearComSignedIn } from '../../support/helpers/near-com-transfer-preconditions';
import {
  assertSwapFundingPrerequisites,
  ensurePaySideWithExecutableQuote,
} from '../../support/helpers/near-trade-swap-flow';
import {
  buildIntentsExactInputQuote,
  fetchOneClickTokens,
  pickDefaultOneClickSwapPair,
  postOneClickQuote,
} from '../../../support/oneclick-client';

test.describe.configure({ timeout: 240_000 });

const strictBrowserNetwork = process.env.TEST_ONECLICK_BROWSER_NETWORK?.trim() === '1';

async function assertOneClickApiContractFallback(reason: string): Promise<void> {
  const tokens = await fetchOneClickTokens();
  expect(tokens.length, `${reason} — GET /v0/tokens`).toBeGreaterThan(0);
  const pair = pickDefaultOneClickSwapPair(tokens);
  expect(pair, `${reason} — default USDC→wNEAR pair`).toBeTruthy();
  const res = await postOneClickQuote(buildIntentsExactInputQuote(pair!, { dry: true }));
  expect(res.quote.amountIn).toMatch(/^\d+$/);
  expect(res.quote.amountOut).toMatch(/^\d+$/);
}

test('Swap UI triggers 1Click GET /v0/tokens and POST /v0/quote (when proxied in browser)', async ({
  wcPage,
  wcBridge,
}) => {
  const recorder = attachOneClickNetworkRecorder(wcPage);

  try {
    await transferFlowPreconditionsNearComSignedIn(wcPage, wcBridge.evmAddress);
    await assertSwapFundingPrerequisites(wcPage);

    const pay = await ensurePaySideWithExecutableQuote(wcPage);
    expect(pay, 'need funded pay side + executable quote').toBeTruthy();

    await wcPage.waitForTimeout(3000);

    const sawTokens = recorder.sawTokensCatalog();
    const sawQuote = recorder.sawQuoteRequest();

    if (!sawTokens || !sawQuote) {
      const msg =
        `No 1Click-shaped browser traffic (tokens=${sawTokens}, quote=${sawQuote}). ` +
        `${recorder.debugSummary()}.`;
      if (strictBrowserNetwork) {
        expect(sawTokens, msg).toBe(true);
        expect(sawQuote, msg).toBe(true);
      } else {
        await assertOneClickApiContractFallback(msg);
        test.info().annotations.push({
          type: 'oneclick-fallback',
          description: 'Verified chaindefuser API directly (near.com quotes server-side).',
        });
      }
      return;
    }

    expect(recorder.calls.some(c => c.status >= 200 && c.status < 300)).toBe(true);
  } finally {
    recorder.dispose();
  }
});
