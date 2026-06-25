/**
 * Wallet chain — step 3: /swap ranks funded pay tokens from balances and can select the top candidate.
 */
import { test } from '../fixtures/wallet-worker-chain';
import { assertSwapFundingPrerequisites } from '../../support/helpers/near-trade-swap-flow';

test.describe.configure({ timeout: 180_000 });

test('Swap page: funded pay token picked from balances (not defaults)', async ({
  wcPage,
  wcBridge,
}) => {
  await assertSwapFundingPrerequisites(wcPage, wcBridge);
});
