/**
 * Wallet chain — step 4: swap UI + Trade complete card + 1Click GET /v0/status → SUCCESS.
 */
import { test } from '../fixtures/wallet-worker-chain';
import { attachOneClickQuoteCapture } from '../../support/helpers/oneclick-quote-capture';
import { completeSwapTradeAndVerifyExplorer } from '../../support/helpers/near-trade-swap-flow';

test.describe.configure({ timeout: 1_200_000 });

test('Swap: submit → explorer → Trade complete → 1Click status SUCCESS', async ({
  wcPage,
  wcContext,
  wcBridge,
}) => {
  const quoteCapture = attachOneClickQuoteCapture(wcPage);
  try {
    await completeSwapTradeAndVerifyExplorer(wcPage, wcContext, wcBridge, {
      quoteCapture,
      pollOneClickStatus: process.env.TEST_ONECLICK_STATUS_POLL?.trim() === '1',
    });
  } finally {
    quoteCapture.dispose();
  }
});
