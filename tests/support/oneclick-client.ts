/**
 * NEAR Intents 1Click REST client — https://1click.chaindefuser.com
 * @see https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens
 */

export const ONECLICK_API_BASE =
  (process.env.ONECLICK_API_URL ?? 'https://1click.chaindefuser.com').replace(/\/$/, '');

export type OneClickToken = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number | string;
  priceUpdatedAt: string;
  contractAddress?: string;
};

export type QuoteRequestBody = {
  dry: boolean;
  swapType: 'EXACT_INPUT' | 'EXACT_OUTPUT' | 'FLEX_INPUT' | 'ANY_INPUT';
  slippageTolerance: number;
  originAsset: string;
  destinationAsset: string;
  amount: string;
  depositType?: 'ORIGIN_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
  refundType?: 'ORIGIN_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
  recipientType?: 'DESTINATION_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
  depositMode?: 'SIMPLE' | 'MEMO';
  refundTo: string;
  recipient: string;
  deadline: string;
  quoteWaitingTimeMs?: number;
  referral?: string;
  connectedWallets?: string[];
  sessionId?: string;
};

export type QuoteResponseBody = {
  correlationId?: string;
  timestamp?: string;
  signature?: string;
  quoteRequest: QuoteRequestBody;
  quote: {
    depositAddress?: string;
    depositMemo?: string | null;
    amountIn: string;
    amountInFormatted: string;
    amountOut: string;
    amountOutFormatted: string;
    minAmountIn?: string;
    minAmountOut?: string;
    deadline?: string;
    timeWhenInactive?: string;
    timeEstimate: number;
  };
};

export type ExecutionStatus =
  | 'KNOWN_DEPOSIT_TX'
  | 'PENDING_DEPOSIT'
  | 'INCOMPLETE_DEPOSIT'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'FAILED';

export type StatusResponseBody = {
  correlationId: string;
  status: ExecutionStatus;
  updatedAt: string;
  quoteResponse?: QuoteResponseBody;
  swapDetails?: Record<string, unknown>;
};

export type OneClickHttpError = {
  status: number;
  message: string;
  body?: unknown;
};

export function oneclickHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const key = process.env.ONECLICK_API_KEY?.trim();
  if (key) headers['X-API-Key'] = key;
  const bearer = process.env.ONECLICK_JWT?.trim();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return headers;
}

export function quoteDeadlineIso(minutesFromNow = 30): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}

/** NEAR account for INTENTS refund/recipient (near.com-style routing). */
export function oneclickIntentsAccountId(): string {
  return (
    process.env.TEST_ONECLICK_INTENTS_ACCOUNT?.trim() ||
    process.env.TEST_INTENTS_ACCOUNT_ID?.trim() ||
    process.env.NEAR_WALLETCONNECT_ACCOUNT?.trim() ||
    'relay.tg'
  );
}

export function findOneClickToken(
  tokens: OneClickToken[],
  symbol: string,
  blockchain: string
): OneClickToken | undefined {
  const sym = symbol.toLowerCase();
  const chain = blockchain.toLowerCase();
  return tokens.find(
    t => t.symbol.toLowerCase() === sym && String(t.blockchain).toLowerCase() === chain
  );
}

/** Default near.com-style pair: USDC → wNEAR on NEAR (overridable via env asset ids). */
export function pickDefaultOneClickSwapPair(
  tokens: OneClickToken[]
): { origin: OneClickToken; destination: OneClickToken } | null {
  const originId = process.env.TEST_ONECLICK_ORIGIN_ASSET_ID?.trim();
  const destId = process.env.TEST_ONECLICK_DEST_ASSET_ID?.trim();
  if (originId && destId) {
    const origin = tokens.find(t => t.assetId === originId);
    const destination = tokens.find(t => t.assetId === destId);
    if (origin && destination) return { origin, destination };
  }

  const usdc =
    findOneClickToken(tokens, 'USDC', 'near') ??
    findOneClickToken(tokens, 'usdc', 'near');
  const wnear =
    findOneClickToken(tokens, 'wNEAR', 'near') ??
    findOneClickToken(tokens, 'NEAR', 'near');

  if (usdc && wnear && usdc.assetId !== wnear.assetId) {
    return { origin: usdc, destination: wnear };
  }

  const onNear = tokens.filter(t => t.blockchain === 'near');
  if (onNear.length >= 2) {
    return { origin: onNear[0]!, destination: onNear[1]! };
  }
  return null;
}

export function buildIntentsExactInputQuote(
  pair: { origin: OneClickToken; destination: OneClickToken },
  opts: { dry: boolean; amountBaseUnits?: string }
): QuoteRequestBody {
  const account = oneclickIntentsAccountId();
  const amount =
    opts.amountBaseUnits?.trim() ||
    process.env.TEST_ONECLICK_AMOUNT_BASE_UNITS?.trim() ||
    '1000000';

  return {
    dry: opts.dry,
    swapType: 'EXACT_INPUT',
    slippageTolerance: Number(process.env.TEST_ONECLICK_SLIPPAGE_BPS ?? '100') || 100,
    originAsset: pair.origin.assetId,
    destinationAsset: pair.destination.assetId,
    amount,
    depositType: 'INTENTS',
    refundType: 'INTENTS',
    recipientType: 'INTENTS',
    depositMode: 'SIMPLE',
    refundTo: account,
    recipient: account,
    deadline: quoteDeadlineIso(),
    quoteWaitingTimeMs: 0,
  };
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text().catch(() => undefined);
  }
  const message =
    typeof body === 'object' && body && 'message' in body
      ? String((body as { message: string }).message)
      : `HTTP ${res.status}`;
  const err: OneClickHttpError = { status: res.status, message, body };
  throw err;
}

export async function fetchOneClickTokens(): Promise<OneClickToken[]> {
  const res = await fetch(`${ONECLICK_API_BASE}/v0/tokens`, {
    headers: oneclickHeaders(),
  });
  await throwIfNotOk(res);
  const data = await parseJson<OneClickToken[]>(res);
  if (!Array.isArray(data)) {
    throw new Error('GET /v0/tokens: expected JSON array');
  }
  return data;
}

export async function postOneClickQuote(body: QuoteRequestBody): Promise<QuoteResponseBody> {
  const res = await fetch(`${ONECLICK_API_BASE}/v0/quote`, {
    method: 'POST',
    headers: oneclickHeaders(),
    body: JSON.stringify(body),
  });
  await throwIfNotOk(res);
  return parseJson<QuoteResponseBody>(res);
}

export async function getOneClickStatus(
  depositAddress: string,
  depositMemo?: string
): Promise<StatusResponseBody> {
  const url = new URL(`${ONECLICK_API_BASE}/v0/status`);
  url.searchParams.set('depositAddress', depositAddress);
  if (depositMemo) url.searchParams.set('depositMemo', depositMemo);
  const res = await fetch(url.toString(), { headers: oneclickHeaders() });
  await throwIfNotOk(res);
  return parseJson<StatusResponseBody>(res);
}

export async function postOneClickDepositSubmit(body: {
  txHash: string;
  depositAddress: string;
  memo?: string;
  nearSenderAccount?: string;
}): Promise<StatusResponseBody> {
  const res = await fetch(`${ONECLICK_API_BASE}/v0/deposit/submit`, {
    method: 'POST',
    headers: oneclickHeaders(),
    body: JSON.stringify(body),
  });
  await throwIfNotOk(res);
  return parseJson<StatusResponseBody>(res);
}

export async function getOneClickAnyInputWithdrawals(
  depositAddress: string,
  opts?: { depositMemo?: string; page?: number; limit?: number }
): Promise<unknown> {
  const url = new URL(`${ONECLICK_API_BASE}/v0/any-input/withdrawals`);
  url.searchParams.set('depositAddress', depositAddress);
  if (opts?.depositMemo) url.searchParams.set('depositMemo', opts.depositMemo);
  if (opts?.page != null) url.searchParams.set('page', String(opts.page));
  if (opts?.limit != null) url.searchParams.set('limit', String(opts.limit));
  const res = await fetch(url.toString(), { headers: oneclickHeaders() });
  await throwIfNotOk(res);
  return parseJson(res);
}

/** Direct 1Click host or near.com / other BFF paths that proxy the same contract. */
export function isOneClickApiUrl(url: string): boolean {
  if (/chaindefuser\.com|defuse\.org|near-intents\.org/i.test(url)) return true;
  if (/\/v0\/(tokens|quote|status|deposit\/submit|any-input\/withdrawals)/i.test(url)) return true;
  try {
    const { hostname, pathname, search } = new URL(url);
    const blob = `${pathname}${search}`;
    if (/near\.com$/i.test(hostname) && /\/api\//i.test(pathname)) {
      if (/(quote|tokens|swap|intents|oneclick|1click|solver|defuse)/i.test(blob)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function isOneClickTokensPath(path: string): boolean {
  return /\/v0\/tokens\b|\/tokens\b/i.test(path);
}

export function isOneClickQuotePath(path: string): boolean {
  return /\/v0\/quote\b|\/quote\b/i.test(path);
}

export const ONECLICK_TERMINAL_STATUSES: readonly ExecutionStatus[] = [
  'SUCCESS',
  'FAILED',
  'REFUNDED',
  'INCOMPLETE_DEPOSIT',
];

export function isTerminalOneClickStatus(status: string): status is ExecutionStatus {
  return (ONECLICK_TERMINAL_STATUSES as readonly string[]).includes(status);
}

const INTENTS_DEPOSIT_HEX = /^[0-9a-f]{64}$/i;
const EVM_DEPOSIT = /^0x[0-9a-fA-F]{40}$/;

export function looksLikeOneClickDepositAddress(value: string): boolean {
  const v = value.trim();
  return INTENTS_DEPOSIT_HEX.test(v) || EVM_DEPOSIT.test(v);
}

/** Collect likely deposit ids from free text (explorer copy, DOM, WC JSON). */
export function collectDepositAddressCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b[0-9a-f]{64}\b/gi)) {
    const v = m[0]!.toLowerCase();
    if (looksLikeOneClickDepositAddress(v)) out.add(v);
  }
  for (const m of text.matchAll(/\b0x[0-9a-fA-F]{40}\b/g)) {
    out.add(m[0]!.toLowerCase());
  }
  return [...out];
}

export function extractDepositAddressDeep(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    if (looksLikeOneClickDepositAddress(value)) return value.trim();
    const fromText = collectDepositAddressCandidates(value);
    return fromText[0] ?? null;
  }
  if (typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractDepositAddressDeep(item);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of ['depositAddress', 'deposit_address', 'depositAddr', 'deposit']) {
    const v = record[key];
    if (typeof v === 'string' && looksLikeOneClickDepositAddress(v)) return v.trim();
  }
  for (const v of Object.values(record)) {
    const found = extractDepositAddressDeep(v);
    if (found) return found;
  }
  return null;
}

export function extractDepositAddressFromWcCaptures(
  captures: readonly { method: string; params: unknown }[]
): string | null {
  for (let i = captures.length - 1; i >= 0; i--) {
    const cap = captures[i]!;
    const fromParams = extractDepositAddressDeep(cap.params);
    if (fromParams) return fromParams;
    try {
      const blob = JSON.stringify(cap.params ?? []);
      const fromBlob = collectDepositAddressCandidates(blob);
      if (fromBlob[0]) return fromBlob[0];
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function extractDepositAddressFromUrls(
  urls: Iterable<string>
): { depositAddress: string; depositMemo?: string } | null {
  for (const raw of urls) {
    try {
      const u = new URL(raw);
      const depositAddress =
        u.searchParams.get('depositAddress') ??
        u.searchParams.get('deposit_address') ??
        u.searchParams.get('address');
      if (depositAddress && looksLikeOneClickDepositAddress(depositAddress)) {
        const depositMemo = u.searchParams.get('depositMemo') ?? u.searchParams.get('memo') ?? undefined;
        return { depositAddress: depositAddress.trim(), depositMemo: depositMemo || undefined };
      }
      for (const segment of u.pathname.split('/').filter(Boolean)) {
        if (looksLikeOneClickDepositAddress(segment)) {
          const depositMemo = u.searchParams.get('depositMemo') ?? u.searchParams.get('memo') ?? undefined;
          return { depositAddress: segment, depositMemo: depositMemo || undefined };
        }
      }
      for (const cand of collectDepositAddressCandidates(`${u.pathname}${u.search}${u.hash}`)) {
        return { depositAddress: cand };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Prefer candidates that 1Click /v0/status recognizes (not 404). */
export async function resolveVerifiedOneClickDepositAddress(
  candidates: Iterable<string>,
  depositMemo?: string
): Promise<{ depositAddress: string; depositMemo?: string } | null> {
  const seen = new Set<string>();
  for (const raw of candidates) {
    const addr = raw.trim();
    if (!addr || seen.has(addr.toLowerCase())) continue;
    seen.add(addr.toLowerCase());
    if (!looksLikeOneClickDepositAddress(addr)) continue;
    try {
      await getOneClickStatus(addr, depositMemo);
      return { depositAddress: addr, depositMemo };
    } catch (e) {
      const err = e as OneClickHttpError;
      if (err.status === 404) continue;
      return { depositAddress: addr, depositMemo };
    }
  }
  return null;
}

/** Walk JSON for `quote.depositAddress` (1Click or BFF-wrapped). */
export function extractDepositAddressFromJson(body: unknown): {
  depositAddress: string;
  depositMemo?: string;
  quoteResponse?: QuoteResponseBody;
} | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  const candidates = [root, root.data as Record<string, unknown> | undefined].filter(Boolean) as Record<
    string,
    unknown
  >[];
  for (const node of candidates) {
    const quote = node.quote as QuoteResponseBody['quote'] | undefined;
    const addr = quote?.depositAddress;
    if (typeof addr === 'string' && addr.length >= 8) {
      return {
        depositAddress: addr,
        depositMemo: typeof quote?.depositMemo === 'string' ? quote.depositMemo : undefined,
        quoteResponse: 'quoteRequest' in node ? (node as QuoteResponseBody) : undefined,
      };
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parsePositiveInt(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  const n = Number(String(raw ?? '').replace(/_/g, '').trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Poll GET /v0/status until a terminal state (default: require `SUCCESS`).
 * @see https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status
 */
export async function pollOneClickStatusUntilTerminal(
  depositAddress: string,
  opts?: {
    depositMemo?: string;
    timeoutMs?: number;
    intervalMs?: number;
    /** When true (default), reject on FAILED / REFUNDED / INCOMPLETE_DEPOSIT. */
    requireSuccess?: boolean;
  }
): Promise<StatusResponseBody> {
  const timeoutMs = parsePositiveInt(
    opts?.timeoutMs ?? process.env.TEST_ONECLICK_STATUS_TIMEOUT_MS,
    600_000
  );
  const intervalMs = parsePositiveInt(
    opts?.intervalMs ?? process.env.TEST_ONECLICK_STATUS_INTERVAL_MS,
    5000
  );
  const requireSuccess = opts?.requireSuccess !== false;
  const deadline = Date.now() + timeoutMs;
  let last: StatusResponseBody | null = null;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      last = await getOneClickStatus(depositAddress, opts?.depositMemo);
      lastError = undefined;
      if (isTerminalOneClickStatus(last.status)) {
        if (requireSuccess && last.status !== 'SUCCESS') {
          throw new Error(
            `1Click swap ended with ${last.status} (expected SUCCESS). correlationId=${last.correlationId}`
          );
        }
        return last;
      }
    } catch (e) {
      lastError = e;
    }
    await sleep(intervalMs);
  }

  const errHint = lastError instanceof Error ? lastError.message : String(lastError ?? '');
  throw new Error(
    `1Click status poll timed out after ${timeoutMs}ms; last=${last?.status ?? 'n/a'}; ${errHint}`
  );
}
