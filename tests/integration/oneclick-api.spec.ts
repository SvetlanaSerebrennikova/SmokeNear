import '../e2e/support/utils/load-env';
import { describe, expect, test } from 'vitest';
import type { OneClickHttpError } from '../support/oneclick-client';
import {
  buildIntentsExactInputQuote,
  fetchOneClickTokens,
  findOneClickToken,
  getOneClickStatus,
  pickDefaultOneClickSwapPair,
  postOneClickDepositSubmit,
  postOneClickQuote,
} from '../support/oneclick-client';

describe('1Click API — live contract (chaindefuser)', () => {
  test('GET /v0/tokens returns supported assets with assetId and decimals', async () => {
    const tokens = await fetchOneClickTokens();
    expect(tokens.length).toBeGreaterThan(10);

    for (const t of tokens.slice(0, 20)) {
      expect(t.assetId).toMatch(/^nep141:/);
      expect(typeof t.decimals).toBe('number');
      expect(t.decimals).toBeGreaterThanOrEqual(0);
      expect(typeof t.symbol).toBe('string');
      expect(t.symbol.length).toBeGreaterThan(0);
      expect(typeof t.blockchain).toBe('string');
      expect(Number(t.price)).toBeGreaterThanOrEqual(0);
    }
    expect(tokens.some(t => Number(t.price) > 0), 'catalog should include priced assets').toBe(true);

    const usdcNear = findOneClickToken(tokens, 'USDC', 'near');
    expect(usdcNear, 'catalog should list USDC on NEAR for default swap pair').toBeTruthy();
  });

  test('POST /v0/quote dry=true — preview without deposit address', async () => {
    const tokens = await fetchOneClickTokens();
    const pair = pickDefaultOneClickSwapPair(tokens);
    expect(pair, 'set TEST_ONECLICK_*_ASSET_ID or ensure USDC+wNEAR on near').toBeTruthy();

    const body = buildIntentsExactInputQuote(pair!, { dry: true });
    const res = await postOneClickQuote(body);

    expect(res.quote.amountIn).toMatch(/^\d+$/);
    expect(res.quote.amountOut).toMatch(/^\d+$/);
    expect(Number(res.quote.minAmountOut)).toBeLessThanOrEqual(Number(res.quote.amountOut));
    expect(res.quote.depositAddress).toBeUndefined();
    expect(res.quote.deadline).toBeUndefined();
    expect(res.quote.timeEstimate).toBeGreaterThan(0);
  });

  test('POST /v0/quote dry=false — deposit address + GET /v0/status pending', async () => {
    const tokens = await fetchOneClickTokens();
    const pair = pickDefaultOneClickSwapPair(tokens);
    expect(pair).toBeTruthy();

    const body = buildIntentsExactInputQuote(pair!, { dry: false });
    const quoted = await postOneClickQuote(body);

    expect(quoted.quote.depositAddress).toBeTruthy();
    expect(quoted.quote.deadline).toBeTruthy();
    expect(quoted.correlationId ?? quoted.timestamp).toBeTruthy();

    const status = await getOneClickStatus(quoted.quote.depositAddress!);
    expect(['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING']).toContain(status.status);
    expect(status.updatedAt).toBeTruthy();
  });

  test('POST /v0/quote — invalid originAsset returns 400', async () => {
    const tokens = await fetchOneClickTokens();
    const pair = pickDefaultOneClickSwapPair(tokens);
    expect(pair).toBeTruthy();

    const body = buildIntentsExactInputQuote(pair!, { dry: true });
    body.originAsset = 'nep141:definitely-not-a-real-asset-id.e2e';

    await expect(postOneClickQuote(body)).rejects.toMatchObject({
      status: 400,
    } satisfies Partial<OneClickHttpError>);
  });

  test('POST /v0/deposit/submit — accepts notify body and returns execution status', async () => {
    const tokens = await fetchOneClickTokens();
    const pair = pickDefaultOneClickSwapPair(tokens);
    expect(pair).toBeTruthy();

    const quoted = await postOneClickQuote(buildIntentsExactInputQuote(pair!, { dry: false }));
    const depositAddress = quoted.quote.depositAddress!;
    expect(depositAddress).toBeTruthy();

    const afterSubmit = await postOneClickDepositSubmit({
      txHash: '0x' + '0'.repeat(64),
      depositAddress,
    });

    expect(afterSubmit.correlationId).toBeTruthy();
    expect(['KNOWN_DEPOSIT_TX', 'PENDING_DEPOSIT', 'PROCESSING']).toContain(afterSubmit.status);
  });
});
