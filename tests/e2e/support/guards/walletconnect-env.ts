import { normalizeEvmPrivateKey } from '../utils/evm-private-key';
import { nearIntentsAccountIdFromEnv } from '../../../support/near-intents-mt';

const MSG = {
  projectId:
    'Set WALLETCONNECT_PROJECT_ID in .env.test (local) or GitHub Actions secret (CI)',
  privateKey:
    'Set EVM_PRIVATE_KEY (0x + 64 hex) in .env.test (local) or GitHub Actions secret (CI)',
  privateKeyFormat: 'EVM_PRIVATE_KEY must be 64 hex characters (EVM wallet)',
} as const;

function assertWalletConnectEnv(): {
  projectId: string;
  evmPrivateKey: `0x${string}`;
  nearAccountId: string;
} {
  const projectId = process.env.WALLETCONNECT_PROJECT_ID?.trim() ?? '';
  const rawPk = process.env.EVM_PRIVATE_KEY?.trim() ?? '';
  if (!projectId) throw new Error(MSG.projectId);
  if (!rawPk) throw new Error(MSG.privateKey);
  const pk = normalizeEvmPrivateKey(rawPk);
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error(MSG.privateKeyFormat);
  return {
    projectId,
    evmPrivateKey: pk as `0x${string}`,
    nearAccountId: nearIntentsAccountIdFromEnv(),
  };
}

/**
 * WalletConnect secrets for the worker-scoped bridge (throws if missing — test runs and fails clearly).
 */
export function requireWalletConnectEnv(): ReturnType<typeof assertWalletConnectEnv> {
  return assertWalletConnectEnv();
}
