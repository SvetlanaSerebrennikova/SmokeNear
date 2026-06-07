import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const envPath = '.env.test';
const today = new Date().toISOString().slice(0, 10);

let oldAddress = '(none)';
try {
  const old = readFileSync(envPath, 'utf8').match(/EVM_PRIVATE_KEY=(.+)/)?.[1]?.trim();
  if (old) {
    const pk = old.startsWith('0x') ? old : `0x${old}`;
    oldAddress = privateKeyToAccount(pk).address;
  }
} catch {
  /* first run */
}

const newPk = generatePrivateKey();
const newAccount = privateKeyToAccount(newPk);
const newHex = newPk.slice(2);

copyFileSync(envPath, '.env.test.backup');

writeFileSync(
  envPath,
  `# Local secrets only — never commit. EVM key rotated ${today}.
# WALLETCONNECT_PROJECT_ID: create a NEW project at https://cloud.reown.com and paste below.

APP_URL=https://near.com

WALLETCONNECT_PROJECT_ID=
EVM_PRIVATE_KEY=${newHex}
`
);

console.log(
  JSON.stringify(
    {
      oldAddress,
      newAddress: newAccount.address,
      walletConnectCleared: true,
      backup: '.env.test.backup',
    },
    null,
    2
  )
);
