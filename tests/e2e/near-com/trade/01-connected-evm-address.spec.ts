/**
 * Wallet chain — step 1: after WC pairing, Account → My address shows the connected EVM address.
 */
import { test } from '../fixtures/wallet-worker-chain';
import { assertConnectedEvmAddressViaMyAddressModal } from '../../support/helpers/near-com-my-address-modal';

test.describe.configure({ timeout: 180_000 });

test('WalletConnect: My Address modal shows connected EVM address', async ({ wcPage, wcBridge }) => {
  await assertConnectedEvmAddressViaMyAddressModal(wcPage, wcBridge.evmAddress);
});
