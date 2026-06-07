import type { Locator, Page } from '@playwright/test';

export function normalizeSwapUiBlob(t: string): string {
  return t.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Words that often appear as `123 word` in marketing copy but are not portfolio tickers.
 * Used when scraping `amount + symbol` lines from normalized UI text (not for click targets).
 */
const SCRAPE_WORD_NOT_TICKER = new Set([
  'max', 'day', 'usd', 'apy', 'tvl', 'gas', 'fee', 'and', 'the', 'for', 'you', 'all', 'off',
  'swap', 'trade', 'get', 'use', 'set', 'edit', 'more', 'less', 'now', 'new', 'per', 'sec',
  'min', 'available', 'balance', 'total', 'your', 'tokens', 'select', 'chain', 'from', 'with',
  'complete',
  /** Modal / list chrome (`getByLabel('Select item')`, generic rows). */
  'item', 'row', 'asset', 'assets', 'holding', 'holdings', 'estimated', 'popular', 'recent',
]);

export function isUiScrapeNoiseTicker(word: string): boolean {
  return SCRAPE_WORD_NOT_TICKER.has(word.toLowerCase());
}

/**
 * Ticker guess from a modal row: label usually leads the row; full names and balances follow.
 */
export function scrapeLikelyTickerFromUiLine(line: string): string | null {
  const s = normalizeSwapUiBlob(line);
  const words = s.match(/\b[a-z][a-z0-9]{1,11}\b/g) ?? [];
  for (const w of words) {
    if (!SCRAPE_WORD_NOT_TICKER.has(w)) return w;
  }
  return null;
}

/**
 * Stronger than `scrapeLikelyTickerFromUiLine`: handles `amount TICKER`, rows where the first
 * alphabetic token is noise, and ALLCAPS tickers before normalization.
 */
export function inferTickerFromUiScrapeLine(line: string): string | null {
  const fromWords = scrapeLikelyTickerFromUiLine(line);
  if (fromWords && !isUiScrapeNoiseTicker(fromWords)) return fromWords;

  const s = normalizeSwapUiBlob(line);
  const pairs = [...s.matchAll(/(\d+(?:[.,]\d+)?)\s+([a-z][a-z0-9]{1,11})\b/gi)];
  for (let i = pairs.length - 1; i >= 0; i--) {
    const sym = pairs[i]![2]!.toLowerCase();
    if (!isUiScrapeNoiseTicker(sym)) return sym;
  }

  const raw = line.replace(/\u00a0/g, ' ');
  const caps = raw.match(/\b([A-Z][A-Z0-9]{1,11})\b/g);
  if (caps) {
    for (let i = caps.length - 1; i >= 0; i--) {
      const low = caps[i]!.toLowerCase();
      if (!isUiScrapeNoiseTicker(low)) return low;
    }
  }

  return null;
}

export type SwapTicker = string;

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Optional `{"wnear":"near"}`-style map (env `TEST_SYMBOL_ALIAS_JSON`): one canonical key for balances + picker.
 */
function applySymbolAliasFromEnv(symbol: string): string {
  const k = symbol.toLowerCase();
  const j = process.env.TEST_SYMBOL_ALIAS_JSON?.trim();
  if (!j) return k;
  try {
    const m = JSON.parse(j) as Record<string, string>;
    return m[k]?.toLowerCase() ?? k;
  } catch {
    return k;
  }
}

/** Same normalization as balance scrape — use after `scrapeLikelyTickerFromUiLine`. */
export function canonicalScrapedSymbol(symbol: string): string {
  return applySymbolAliasFromEnv(symbol.toLowerCase());
}

/** Labels that refer to the same logical balance bucket as `canonical` (reverse of alias map). */
export function symbolLabelsForBalanceParse(canonical: string): string[] {
  const k = canonical.toLowerCase();
  const j = process.env.TEST_SYMBOL_ALIAS_JSON?.trim();
  if (!j) return [k];
  try {
    const map = JSON.parse(j) as Record<string, string>;
    const labels = new Set<string>([k]);
    for (const [from, to] of Object.entries(map)) {
      if (String(to).toLowerCase() === k) labels.add(String(from).toLowerCase());
    }
    return [...labels];
  } catch {
    return [k];
  }
}

/** Max balance line among all alias labels for this symbol. */
export function maxParsedBalanceForSymbol(normLower: string, canonical: string): number | null {
  let best: number | null = null;
  for (const lab of symbolLabelsForBalanceParse(canonical)) {
    const v = parseMaxBalanceBeforeTicker(normLower, lab);
    if (v != null) best = best == null ? v : Math.max(best, v);
  }
  return best;
}

/** Largest numeric literal before a ticker label in normalized UI copy. */
export function parseMaxBalanceBeforeTicker(normLower: string, ticker: string): number | null {
  const esc = escapeRegExp(ticker.toLowerCase());
  const re = new RegExp(String.raw`(\d+(?:[.,]\d+)?)\s*${esc}\b`, 'gi');
  const values: number[] = [];
  for (let m = re.exec(normLower); m; m = re.exec(normLower)) {
    const num = Number.parseFloat(m[1]!.replace(',', '.'));
    if (Number.isFinite(num) && num >= 0) values.push(num);
  }
  if (!values.length) return null;
  return Math.max(...values);
}

export function parseSwapTickerBalances(normLower: string): Map<string, number> {
  const out = new Map<string, number>();
  const re = /(\d+(?:[.,]\d+)?)\s+([a-z][a-z0-9]{1,11})\b/gi;
  for (let m = re.exec(normLower); m; m = re.exec(normLower)) {
    const num = Number.parseFloat(m[1]!.replace(',', '.'));
    let key = m[2]!.toLowerCase();
    if (SCRAPE_WORD_NOT_TICKER.has(key)) continue;
    key = applySymbolAliasFromEnv(key);
    if (!Number.isFinite(num) || num < 0) continue;
    out.set(key, Math.max(out.get(key) ?? 0, num));
  }
  return out;
}

/**
 * Pay-row token control: `data-testid` when present, else first `button` after the amount input (same structure as the live app).
 */
export async function paySideAssetTriggerVisible(page: Page): Promise<Locator | null> {
  const byTestId = page.locator('main').getByTestId('select-assets-input').first();
  if (await byTestId.isVisible().catch(() => false)) return byTestId;
  const amt = page.getByPlaceholder(/enter amount/i).first();
  if (!(await amt.isVisible().catch(() => false))) return null;
  const nextBtn = amt.locator('xpath=following::button[@type="button"][1]');
  if (await nextBtn.isVisible().catch(() => false)) return nextBtn;
  return null;
}

export function minPayForTicker(_ticker: string): number {
  const v = Number(process.env.TEST_MIN_TRADE ?? process.env.TEST_MIN_ALT_TRADE ?? '0.05');
  return Number.isFinite(v) && v > 0 ? v : 0.05;
}

/**
 * Fraction of wallet balance exposed in amount field (rest: fees, rounding).
 */
export function tradeSpendFraction(): number {
  const n = Number(process.env.TEST_TRADE_SPEND_FRACTION ?? '');
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.87;
}

export function tradeMaxSingleAmount(): number {
  const n = Number(process.env.TEST_TRADE_MAX_AMOUNT ?? '');
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function tradeBalanceReserveForTicker(_ticker: string): number {
  const r = Number(process.env.TEST_TRADE_BALANCE_RESERVE ?? process.env.TEST_TRADE_TOKEN_RESERVE ?? '0');
  return Number.isFinite(r) && r >= 0 ? r : 0;
}

export function payAmountFromBalance(balance: number, ticker: string): number {
  const minPay = minPayForTicker(ticker);
  const frac = tradeSpendFraction();
  const reserve = tradeBalanceReserveForTicker(ticker);
  const cap = tradeMaxSingleAmount();
  const raw = balance * frac - reserve;
  if (!Number.isFinite(raw)) return Number.NaN;
  return Math.max(minPay, Math.min(cap, balance * 0.999, raw));
}

export type PayCandidate = { ticker: string; balance: number; minPay: number };

export type ChainBalanceHints = Partial<Record<string, number>>;

/** Merge UI scrapes with chain hints (`intents.near` etc.), applying `TEST_SYMBOL_ALIAS_JSON` to keys. */
export function mergeBalancesUiAndChain(
  uiMap: Map<string, number>,
  chain: ChainBalanceHints
): Map<string, number> {
  const out = new Map(uiMap);
  for (const [rawK, v] of Object.entries(chain)) {
    if (v == null || !Number.isFinite(v)) continue;
    const key = applySymbolAliasFromEnv(rawK.toLowerCase());
    out.set(key, Math.max(out.get(key) ?? 0, v));
  }
  return out;
}

export function rankedPayCandidatesFromMap(balanceByTicker: Map<string, number>): PayCandidate[] {
  const list: PayCandidate[] = [];
  for (const [ticker, balance] of balanceByTicker) {
    const minPay = minPayForTicker(ticker);
    const spendable = payAmountFromBalance(balance, ticker);
    if (balance + 1e-15 >= minPay && spendable + 1e-15 >= minPay) {
      list.push({ ticker, balance, minPay });
    }
  }
  return list.sort((a, b) => b.balance - a.balance || a.minPay - b.minPay);
}

export function rankedPayCandidates(normLower: string): PayCandidate[] {
  return rankedPayCandidatesFromMap(parseSwapTickerBalances(normLower));
}

/** Display / search string for the picker (uppercases the active symbol key). */
export function paySymbolForTicker(ticker: string): string {
  return ticker.toUpperCase();
}

async function chipVisible(page: Page, symU: string): Promise<boolean> {
  const exact = new RegExp(`^${escapeRegExp(symU)}$`, 'i');
  if (await page.getByRole('button', { name: exact }).first().isVisible().catch(() => false))
    return true;
  return page
    .locator('button')
    .filter({ hasText: exact })
    .first()
    .isVisible()
    .catch(() => false);
}

/** Ensures `/swap` pay row uses the desired ticker chip. */
export async function ensurePayTokenSymbol(page: Page, ticker: string): Promise<void> {
  const symU = paySymbolForTicker(ticker);
  const amountInput = page.getByPlaceholder(/enter amount/i).first();
  await amountInput.waitFor({ state: 'visible', timeout: 60_000 });

  if (await chipVisible(page, symU)) return;

  const trigger = await paySideAssetTriggerVisible(page);
  if (trigger) await trigger.click({ timeout: 12_000 }).catch(() => undefined);

  const search = page.getByPlaceholder(/search/i).or(page.locator('input[type="search"]')).first();
  if (await search.isVisible().catch(() => false)) await search.fill(symU);

  await page
    .getByRole('option', { name: new RegExp(symU, 'i') })
    .or(page.getByText(new RegExp(`^bridged\\s*${escapeRegExp(symU)}|^${escapeRegExp(symU)}\\b`, 'i')))
    .first()
    .click({ timeout: 20_000 });
}

/**
 * Fill pay amount from wallet UI balance (fraction minus reserve). Falls back to probing `1` if parse fails.
 */
export async function fillPayAmountWithinBalance(
  page: Page,
  ticker: string,
  opts?: { balanceHintHuman?: number }
): Promise<string> {
  const input = page.getByPlaceholder(/enter amount/i).first();
  const tlow = ticker.toLowerCase();
  const minPay = minPayForTicker(tlow);

  const mt0 = normalizeSwapUiBlob(await page.locator('main').innerText());

  let parsed: number | null =
    opts?.balanceHintHuman != null && opts.balanceHintHuman + 1e-15 >= minPay
      ? opts.balanceHintHuman
      : null;

  if (parsed == null) {
    parsed = maxParsedBalanceForSymbol(mt0, tlow);
  }

  let target: number;
  if (parsed != null && parsed >= minPay) {
    target = payAmountFromBalance(parsed, tlow);
  } else {
    target = Number.NaN;
  }

  if (!Number.isFinite(target) || target < minPay) {
    await input.fill('1');
    await page.waitForTimeout(900);
    const insuff = await page
      .getByRole('button', { name: /insufficient\s*balance/i })
      .first()
      .isVisible()
      .catch(() => false);
    if (!insuff) return '1';

    const curAmt = Number((await input.inputValue()).replace(',', '.'));
    const mt = normalizeSwapUiBlob(await page.locator('main').innerText());
    parsed = maxParsedBalanceForSymbol(mt, tlow);
    const availSpend =
      parsed != null && parsed + 1e-12 < curAmt ? parsed : Number.NaN;

    if (!Number.isFinite(availSpend) || availSpend < minPay) {
      throw new Error(
        `Less than ${minPay} ${paySymbolForTicker(ticker)} available for quote (or balance not parsed). Clip≈ ${mt.slice(0, 240)}…`
      );
    }
    target = payAmountFromBalance(availSpend, tlow);
  }

  const stringifyPay = (n: number) => {
    const x = Math.abs(n);
    if (x >= 1) return `${Math.floor(n * 1_000_000) / 1_000_000}`;
    if (x >= 0.01) return `${Math.floor(n * 1_000_000) / 1_000_000}`;
    if (x >= 0.0001) return `${Math.floor(n * 1e8) / 1e8}`;
    return `${Math.floor(n * 1e12) / 1e12}`;
  };

  let payAmt = stringifyPay(target);
  await input.fill('');
  await input.fill(payAmt);
  await page.waitForTimeout(700);

  if (
    await page
      .getByRole('button', { name: /insufficient\s*balance/i })
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    const mt2 = normalizeSwapUiBlob(await page.locator('main').innerText());
    const p2 = maxParsedBalanceForSymbol(mt2, tlow);
    if (p2 != null && p2 >= minPay) {
      const lower = payAmountFromBalance(p2 * 0.92, tlow);
      payAmt = stringifyPay(lower);
    } else {
      payAmt = stringifyPay(Number.parseFloat(payAmt) * 0.82);
    }
    await input.fill('');
    await input.fill(payAmt);
  }

  return payAmt;
}

/** Token amount needles for cross-checking explorer vs card / WC payloads. */
export function amountNeedlesForTickers(mainNorm: string): string[] {
  const found = new Set<string>();
  const re = /(\d+(?:[.,]\d+)?)\s+([a-z][a-z0-9]{1,11})\b/gi;
  for (let m = re.exec(mainNorm); m; m = re.exec(mainNorm)) {
    const sym = m[2]!.toLowerCase();
    if (SCRAPE_WORD_NOT_TICKER.has(sym)) continue;
    const pair = `${m[1]} ${sym}`.replace(',', '.');
    found.add(pair);
    found.add(pair.replace(/\s+/g, ''));
  }
  return [...found];
}

/** True when explorer copy looks like Near Intents and references the wallet + pay token. */
export function explorerBodyLooksCoherent(
  norm: string,
  connectedEvmAddress: `0x${string}`,
  payTicker: string
): boolean {
  const ex = norm;
  const hex = connectedEvmAddress.replace(/^0x/i, '').toLowerCase();
  if (hex.length < 12) return false;

  /** Intents explorer often ellipsis-middles addresses; accept head or tail fragments. */
  const addrFrags = [hex.slice(0, 4), hex.slice(0, 6), hex.slice(-4), hex.slice(-6)];
  if (!addrFrags.some(f => f.length >= 4 && ex.includes(f))) return false;

  const pay = payTicker.toLowerCase();
  const intentish = /\bintent|near-intents|\.org\/|transaction\s+details/i.test(ex);

  const routeish =
    /\b(from|source).*(\b(eth|ethereum|evm|0x)\b|eip[- ]?155)/i.test(ex) ||
    /\b(to|destination).*(\bnear|nap|account\.id\b)/i.test(ex) ||
    /\bcross.?chain\b/i.test(ex) ||
    /\bbridge\b/i.test(ex);

  const hasNumericTokenLine = /\d+(?:[.,]\d+)?\s+[a-z][a-z0-9]{1,11}\b/i.test(ex);
  const hasRouteOrHoldingsLexicon = /\b(from|to|source|destination|amount|token|asset|bridge|network|sent|received|pay|fill|route)\b/i.test(
    ex
  );
  const assets = hasNumericTokenLine || hasRouteOrHoldingsLexicon;
  const mentionsPay = new RegExp(String.raw`\b${escapeRegExp(pay)}\b`, 'i').test(ex);
  const mentionsPayLoose = mentionsPay || (pay.length >= 2 && ex.includes(pay));

  return intentish && (routeish || assets) && assets && mentionsPayLoose;
}
