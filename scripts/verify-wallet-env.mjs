/**
 * Verifies local `.env.test` matches the configured test wallet address.
 * Does not print private keys.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { privateKeyToAccount } from 'viem/accounts';

const root = process.cwd();

function parseEnvFile(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const defaults = parseEnvFile(resolve(root, '.env.test.defaults'));
const local = parseEnvFile(resolve(root, '.env.test'));
const env = { ...defaults, ...local };

const expected = (env.TEST_EVM_EXPECTED_ADDRESS ?? '').trim();
const rawPk = (env.EVM_PRIVATE_KEY ?? '').trim();
const wcId = (env.WALLETCONNECT_PROJECT_ID ?? '').trim();

if (!rawPk) {
  console.error('ERROR: EVM_PRIVATE_KEY missing in .env.test');
  console.error('Paste the same key you set in GitHub secret EVM_PRIVATE_KEY.');
  process.exit(1);
}

const pk = rawPk.startsWith('0x') ? rawPk : `0x${rawPk}`;
if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  console.error('ERROR: EVM_PRIVATE_KEY must be 64 hex characters (optional 0x prefix).');
  process.exit(1);
}

const derived = privateKeyToAccount(pk).address;
console.log('Derived EVM address:', derived);

if (expected) {
  const ok = derived.toLowerCase() === expected.toLowerCase();
  console.log('Expected (TEST_EVM_EXPECTED_ADDRESS):', expected);
  if (!ok) {
    console.error('ERROR: private key does not match TEST_EVM_EXPECTED_ADDRESS.');
    console.error('Update .env.test to use the key for your new test wallet.');
    process.exit(1);
  }
  console.log('OK: key matches expected test wallet.');
}

if (!wcId) {
  console.warn('WARN: WALLETCONNECT_PROJECT_ID is empty — WC pairing will fail.');
  console.warn('Add a Reown project id to .env.test (and GitHub secret for CI).');
} else {
  console.log('WALLETCONNECT_PROJECT_ID: set');
}

console.log('WalletConnect bridge will sign as:', derived);
