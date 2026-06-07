/**
 * Wallet chain — step 1: after WC pairing, the header shows the same EVM address the bridge signed with.
 */
import { expect, test } from '../fixtures/wallet-worker-chain';
import { nearComEthAccountIndicator, uiTextShowsEthConnection } from '../../support/locators/near-com.account.locators';

test.describe.configure({ timeout: 120_000 });

test('WalletConnect: chrome shows connected EVM address', async ({ wcPage, wcBridge }) => {
  const indicator = nearComEthAccountIndicator(wcPage, wcBridge.evmAddress);
  await expect(indicator).toBeVisible({ timeout: 30_000 });
  expect(uiTextShowsEthConnection(await indicator.textContent(), wcBridge.evmAddress)).toBe(true);
});
