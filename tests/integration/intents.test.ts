import '../e2e/support/utils/load-env';
import { describe, expect, test } from 'vitest';
import {
  humanFromMtUnits,
  intentsMtBalanceOf,
  intentsMtBatchBalanceOf,
  intentsMtInstruments,
  nearIntentsAccountIdFromEnv,
} from '../support/near-intents-mt';

const ACCOUNT = nearIntentsAccountIdFromEnv();

describe('intents.near — mt_balance_of / mt_batch_balance_of (mainnet view)', () => {
  test('mt_balance_of returns a base-10 integer string', async () => {
    const first = intentsMtInstruments()[0];
    expect(first).toBeTruthy();

    const balance = await intentsMtBalanceOf(ACCOUNT, first!.tokenId);
    expect(typeof balance).toBe('string');
    expect(/^\d+$/.test(balance)).toBe(true);
    expect(BigInt(balance)).toBeGreaterThanOrEqual(0n);

    const human = humanFromMtUnits(balance, first!.decimals);
    expect(Number.isFinite(human)).toBe(true);
  });

  test('mt_batch_balance_of returns aligned array', async () => {
    const specs = intentsMtInstruments().slice(0, 5);
    const tokenIds = specs.map(s => s.tokenId);

    const balances = await intentsMtBatchBalanceOf(ACCOUNT, tokenIds);

    expect(Array.isArray(balances)).toBe(true);
    expect(balances).toHaveLength(tokenIds.length);
    for (const b of balances) {
      expect(typeof b).toBe('string');
      expect(BigInt(b)).toBeGreaterThanOrEqual(0n);
    }
  });
});
