/**
 * `@intents.near`: `mt_balance_of` / `mt_batch_balance_of` via NEAR JSON-RPC `query.call_function`.
 * Implemented with `fetch` so Playwright Node runner and Vitest share the same code path.
 */

export const INTENTS_CONTRACT_ID = process.env.TEST_INTENTS_CONTRACT_ID?.trim() || 'intents.near';

export type MtInstrument = {
  /** Key aligned with SWAP tickers (`usdc`, `near`, …) */
  ticker: string;
  /** e.g. `nep141:wrap.near` */
  tokenId: string;
  decimals: number;
};

/**
 * Override via `TEST_INTENTS_MT_INSTRUMENTS_JSON` (JSON array of MtInstrument).
 */
export function intentsMtInstruments(): MtInstrument[] {
  const raw = process.env.TEST_INTENTS_MT_INSTRUMENTS_JSON?.trim();
  if (raw) {
    try {
      return JSON.parse(raw) as MtInstrument[];
    } catch {
      console.warn('[intents-mt] Invalid TEST_INTENTS_MT_INSTRUMENTS_JSON — using defaults');
    }
  }
  return defaultMainnetMtInstruments();
}

function defaultMainnetMtInstruments(): MtInstrument[] {
  return [
    { ticker: 'near', tokenId: 'nep141:wrap.near', decimals: 24 },
    {
      ticker: 'usdc',
      tokenId:
        process.env.TEST_INTENTS_USDC_TOKEN_ID?.trim() ||
        'nep141:172edebae102e85c8cbeb8cb793f18bffc6dcdfcd3cfe3107adbdfabbefc7aab.near',
      decimals: Number(process.env.TEST_INTENTS_USDC_DECIMALS ?? '6') || 6,
    },
    {
      ticker: 'sol',
      tokenId:
        process.env.TEST_INTENTS_SOL_TOKEN_ID?.trim() || 'nep141:sol.omft.near',
      decimals: Number(process.env.TEST_INTENTS_SOL_DECIMALS ?? '9') || 9,
    },
  ];
}

/** Public mainnet account used when env omits NEAR `account_id` (intents / 1Click routing). */
export const DEFAULT_INTENTS_NEAR_ACCOUNT_ID = 'relay.tg';

/** NEAR Intents balances are keyed by NEAR `account_id` (`foo.near`), not `0x…`. */
export function nearIntentsAccountIdFromEnv(): string {
  return (
    process.env.TEST_INTENTS_ACCOUNT_ID?.trim() ||
    process.env.NEAR_WALLETCONNECT_ACCOUNT?.trim() ||
    DEFAULT_INTENTS_NEAR_ACCOUNT_ID
  );
}

function rpcUrl(): string {
  return process.env.NEAR_RPC_URL?.trim() || 'https://rpc.mainnet.near.org';
}

type RpcResponse = {
  result?: { result: number[] };
  error?: { message?: string };
};

export function humanFromMtUnits(rawStr: string, decimals: number): number {
  const s = String(rawStr ?? '').trim();
  if (!/^\d+$/.test(s)) return Number.NaN;
  const hi = BigInt(s);
  const den = 10n ** BigInt(decimals);
  const q = hi / den;
  const rem = hi % den;
  return Number(q) + Number(rem) / Number(den);
}

async function callIntentsView(methodName: string, args: unknown): Promise<unknown> {
  const args_base64 = Buffer.from(JSON.stringify(args)).toString('base64');
  const res = await fetch(rpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `intents-mt-${methodName}-${Date.now()}`,
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: INTENTS_CONTRACT_ID,
        method_name: methodName,
        args_base64,
      },
    }),
  });

  const json = (await res.json()) as RpcResponse;
  if (json.error) {
    throw new Error(json.error.message ?? JSON.stringify(json.error));
  }

  const bytes = json.result?.result;
  if (!bytes?.length) {
    throw new Error(`Empty call_function payload for intents.near.${methodName}`);
  }

  const txt = Buffer.from(bytes).toString('utf8');
  return JSON.parse(txt) as unknown;
}

export async function intentsMtBalanceOf(accountId: string, tokenId: string): Promise<string> {
  const out = await callIntentsView('mt_balance_of', { token_id: tokenId, account_id: accountId });
  return String(out ?? '').trim();
}

export async function intentsMtBatchBalanceOf(accountId: string, tokenIds: string[]): Promise<string[]> {
  const out = await callIntentsView('mt_batch_balance_of', { token_ids: tokenIds, account_id: accountId });
  return Array.isArray(out)
    ? (out as unknown[]).map(v => String(v).trim())
    : [];
}

export type MtHumanBalances = Partial<Record<string, number>>;

/** Human units keyed by SWAP ticker (`near` bucket includes wNEAR wrap position). */
export async function fetchIntentsHumanBalances(accountId: string): Promise<MtHumanBalances> {
  const specs = intentsMtInstruments();
  const tokenIds = specs.map(s => s.tokenId);
  if (!tokenIds.length) return {};

  try {
    const raw = await intentsMtBatchBalanceOf(accountId, tokenIds);
    const out: MtHumanBalances = {};
    for (let i = 0; i < specs.length; i++) {
      const r = raw[i];
      const sp = specs[i];
      if (r === undefined || !sp) continue;
      const h = humanFromMtUnits(String(r), sp.decimals);
      if (!Number.isFinite(h) || h <= 0) continue;
      const tk = sp.ticker.toLowerCase();
      const key = tk === 'wnear' ? 'near' : tk;
      out[key] = Math.max(out[key] ?? 0, h);
    }
    return out;
  } catch {
    return {};
  }
}
