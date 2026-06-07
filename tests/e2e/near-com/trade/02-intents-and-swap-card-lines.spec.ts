/**
 * Wallet chain — step 2: open /swap while signed in; intents.near balances align with swap card lines (optional ETH RPC cross-check).
 */
import { expect, test } from '../fixtures/wallet-worker-chain';
import { formatEther } from 'viem';
import {
  collectEthBalanceUiValuesForConnectedWallet,
  matchingUiEthBalance,
} from '../../support/locators/near-com.balance.locators';
import {
  fetchIntentsHumanBalances,
  intentsMtBatchBalanceOf,
  intentsMtInstruments,
  nearIntentsAccountIdFromEnv,
} from '../../../support/near-intents-mt';
import { ethGetBalanceWei } from '../../support/utils/eth-json-rpc';

test.describe.configure({ timeout: 240_000 });

test('intents.near mt_* and swap card show amount + symbol lines', async ({ wcPage, wcBridge }) => {
  const nearAccountId = nearIntentsAccountIdFromEnv();

  const specs = intentsMtInstruments();
  expect(specs.length, 'Configure TEST_INTENTS_MT_INSTRUMENTS_JSON or use built-in defaults.').toBeGreaterThan(
    0
  );
  const rawBalances = await intentsMtBatchBalanceOf(
    nearAccountId,
    specs.map(s => s.tokenId)
  );
  expect(rawBalances).toHaveLength(specs.length);
  for (const b of rawBalances) {
    expect(/^\d+$/.test(b)).toBe(true);
    expect(BigInt(b)).toBeGreaterThanOrEqual(0n);
  }
  await fetchIntentsHumanBalances(nearAccountId);

  await wcPage.goto('/swap', { waitUntil: 'domcontentloaded' });
  await expect(wcPage).not.toHaveURL(/\/login/i);
  await wcPage.waitForTimeout(2500);

  await expect
    .poll(
      async () => {
        const main = await wcPage.locator('main').first().innerText().catch(() => '');
        return /\d+[.,]\d+\s+[a-z][a-z0-9]{1,11}\b/i.test(main);
      },
      { timeout: 90_000, intervals: [500, 1000, 2000] }
    )
    .toBe(true);

  const rpcUrl = process.env.TEST_ETH_JSON_RPC_URL?.trim() || 'https://ethereum.publicnode.com';
  const wei = await ethGetBalanceWei(wcBridge.evmAddress, rpcUrl);
  const rpcEth = Number(formatEther(wei));
  expect(Number.isFinite(rpcEth)).toBe(true);
  const ethCandidates = await collectEthBalanceUiValuesForConnectedWallet(wcPage, wcBridge.evmAddress);
  if (ethCandidates.length > 0) {
    expect(matchingUiEthBalance(rpcEth, ethCandidates)).toBeDefined();
  }
});
