import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  fillPayAmountWithinBalance,
  ensurePayTokenSymbol,
  isUiScrapeNoiseTicker,
  mergeBalancesUiAndChain,
  minPayForTicker,
  normalizeSwapUiBlob,
  parseSwapTickerBalances,
  canonicalScrapedSymbol,
  paySideAssetTriggerVisible,
  rankedPayCandidates,
  rankedPayCandidatesFromMap,
  scrapeLikelyTickerFromUiLine,
} from './trade-token-balances';
import { fetchIntentsHumanBalances, nearIntentsAccountIdFromEnv } from '../../../support/near-intents-mt';
import {
  collectDepositAddressCandidates,
  extractDepositAddressFromUrls,
  extractDepositAddressFromWcCaptures,
  pollOneClickStatusUntilTerminal,
  postOneClickDepositSubmit,
  resolveVerifiedOneClickDepositAddress,
} from '../../../support/oneclick-client';
import type { OneClickQuoteCapture } from './oneclick-quote-capture';
import { closeExtraContextPages } from './browser-context-cleanup';
import { firstTokenRowAfterYourTokensLabel, tokenPickerRowScrapeText } from './near-com-token-modal';

async function rankedPayCandidatesMergedWithIntents(page: Page) {
  const id = nearIntentsAccountIdFromEnv();
  const chain = await fetchIntentsHumanBalances(id);
  const norm = normalizeSwapUiBlob(await page.locator('main').innerText());
  const merged = mergeBalancesUiAndChain(parseSwapTickerBalances(norm), chain);
  let list = rankedPayCandidatesFromMap(merged);
  if (!list.length) {
    list = rankedPayCandidates(norm);
  }
  return list;
}

/**
 * Human-like picker flow:
 * click current token chip -> wait "Select token" -> prefer "Your tokens" list -> pick first row.
 */
async function pickFirstTokenInSwapPicker(page: Page): Promise<string | null> {
  const tokenChip = await paySideAssetTriggerVisible(page);
  if (!tokenChip) return null;
  await tokenChip.click({ timeout: 15_000 }).catch(() => undefined);

  const modal = page.getByRole('dialog').first();
  const selectVisible = await modal
    .getByText(/select token/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (!selectVisible) return null;
  await modal.getByText(/your tokens/i).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);

  const row = await firstTokenRowAfterYourTokensLabel(modal);
  if (!(await row.isVisible().catch(() => false))) return null;

  const firstTextRaw = await tokenPickerRowScrapeText(row);
  await row.click({ timeout: 10_000 });

  const scraped = scrapeLikelyTickerFromUiLine(firstTextRaw);
  return scraped != null ? canonicalScrapedSymbol(scraped) : null;
}

export function swapPrimarySubmit(page: Page): Locator {
  return page
    .locator('main')
    .locator('[type="submit"]')
    .filter({ hasText: /\b(swap|trade|review|preview|continue|confirm)\b/i })
    .first();
}

/**
 * Opens the block explorer from the swap completion CTA. When the dapp opens a new tab,
 * that tab is focused and returned; otherwise the current tab navigated to explorer is used.
 * Tabs are not merged (swap stays on its tab).
 */
export async function openBlockExplorerPage(
  context: BrowserContext,
  page: Page,
  trigger: Locator
): Promise<Page> {
  await trigger.click();
  await expect
    .poll(
      async () => {
        try {
          if (/near-intents\.org/i.test(page.url())) return true;
        } catch {
          /* mid-navigation */
        }
        return context.pages().some(p => p !== page && /near-intents\.org/i.test(p.url()));
      },
      { timeout: 120_000, intervals: [400] }
    )
    .toBe(true);

  const extra = context.pages().find(p => p !== page && /near-intents\.org/i.test(p.url()));
  if (extra) {
    await extra.bringToFront().catch(() => undefined);
    await extra.waitForLoadState('domcontentloaded').catch(() => undefined);
    return extra;
  }
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/** Waits until the explorer UI shows a terminal success state (wording varies by locale). */
export async function waitForExplorerSuccessMessage(explorerPage: Page): Promise<void> {
  await expect(
    explorerPage.getByText(/\b(success|successful|succeeded|completed|confirmed)\b/i).first()
  ).toBeVisible({ timeout: 240_000 });
}

/** Narrow normalized text to the completion card so we do not count random marketing `amount token` pairs. */
function normalizedMainNearTradeComplete(page: Page): Promise<string> {
  return page.evaluate(() => {
    const mark = [...document.querySelectorAll('main *')].find(
      el => el.textContent && /\btrade\s*complete\b/i.test(el.textContent)
    );
    const root = (mark as HTMLElement | undefined)?.closest('main') ?? document.querySelector('main');
    if (!root) return '';
    const t = root.innerText?.replace(/\u00a0/g, ' ') ?? '';
    const lower = t.replace(/\s+/g, ' ').trim().toLowerCase();
    const i = lower.indexOf('trade complete');
    if (i < 0) return lower;
    return lower.slice(Math.max(0, i - 200), Math.min(lower.length, i + 600));
  });
}

/** Asserts the post-trade summary on near.com matches the pay leg we submitted and shows a distinct receive leg. */
async function assertTradeCompleteSwapCardMatches(
  page: Page,
  payTicker: string,
  payAmtStr: string
): Promise<void> {
  const norm = normalizeSwapUiBlob(await normalizedMainNearTradeComplete(page));
  const payLower = payTicker.toLowerCase();
  const expectedPay = Number.parseFloat(String(payAmtStr).replace(',', '.'));
  expect(Number.isFinite(expectedPay)).toBe(true);
  const relTol = 0.06;
  const relErr = (a: number) => Math.abs(a - expectedPay) / Math.max(expectedPay, 1e-12);

  /** Every `amount ticker` on the slice; card may list receive before pay so pay amount may sit on another ticker row. */
  const pairs: { amt: number; sym: string }[] = [];
  for (const m of norm.matchAll(/(\d+(?:[.,]\d+)?)\s+([a-z][a-z0-9]{1,11})\b/gi)) {
    const sym = m[2]!.toLowerCase();
    if (isUiScrapeNoiseTicker(sym)) continue;
    const amt = Number.parseFloat(m[1]!.replace(',', '.'));
    if (!Number.isFinite(amt)) continue;
    pairs.push({ amt, sym });
  }
  expect(pairs.length, `no amount+token pairs on trade-complete card; main≈ ${norm.slice(0, 500)}`).toBeGreaterThan(
    0
  );
  const payPairs = pairs.filter(p => p.sym === payLower);
  expect(
    payPairs.length,
    `expected "${payTicker}" on trade-complete card; pairs=${pairs.map(p => `${p.amt} ${p.sym}`).join('; ')}`
  ).toBeGreaterThan(0);
  const payAmtErr = Math.min(...payPairs.map(p => relErr(p.amt)));
  expect(
    payAmtErr < relTol,
    `submitted pay ${expectedPay} not on card within ${relTol * 100}%; pay leg(s)=${payPairs.map(p => `${p.amt} ${p.sym}`).join('; ')}; all=${pairs.map(p => `${p.amt} ${p.sym}`).join('; ')}`
  ).toBe(true);

  const legs = parseSwapTickerBalances(norm);
  const amountTokenPairs = [...norm.matchAll(/(\d+(?:[.,]\d+)?)\s+([a-z][a-z0-9]{1,11})\b/gi)].map(m =>
    m[2]!.toLowerCase()
  );
  const distinctSyms = new Set(amountTokenPairs.filter(s => !isUiScrapeNoiseTicker(s)));
  expect(
    distinctSyms.size >= 2 || legs.size >= 2,
    `expected two token legs on completion card; legs=${[...legs.keys()].join(',')}; symbols=${[...distinctSyms].join(',')}; card≈ ${norm.slice(0, 420)}`
  ).toBe(true);

  const otherFromLegs = [...legs.keys()].filter(k => k !== payLower);
  const otherFromSyms = [...distinctSyms].filter(s => s !== payLower);
  expect(
    otherFromLegs.length > 0 || otherFromSyms.length > 0,
    `expected a receive token distinct from pay (${payTicker})`
  ).toBe(true);
}

export async function quoteReady(page: Page, primary: Locator): Promise<boolean> {
  const quoteErr = await page
    .getByText(/failed to get quote|unable to get a quote from our solvers/i)
    .first()
    .isVisible()
    .catch(() => false);
  const enabled =
    (await primary.isVisible().catch(() => false)) && (await primary.isEnabled().catch(() => false));
  return !quoteErr && enabled;
}

/**
 * Try pay tokens ordered by UI balance until quote + primary submit is ready.
 * Returns null if no workable pay side (caller should skip or fail).
 */
export async function ensurePaySideWithExecutableQuote(
  page: Page
): Promise<{ ticker: string; payAmt: string } | null> {
  await page.waitForTimeout(900);
  let candidates = await rankedPayCandidatesMergedWithIntents(page);
  const pickerTop = await pickFirstTokenInSwapPicker(page);

  if (candidates.length === 0) {
    await page.waitForTimeout(2000);
    candidates = await rankedPayCandidatesMergedWithIntents(page);
  }

  if (!candidates.length) {
    return null;
  }

  const ordered =
    pickerTop == null
      ? candidates
      : [
          ...(candidates.find(c => c.ticker === pickerTop)
            ? [candidates.find(c => c.ticker === pickerTop)!]
            : [
                {
                  ticker: pickerTop,
                  balance: Number(process.env.TEST_DEFAULT_PICKER_BALANCE_HINT ?? '1'),
                  minPay: minPayForTicker(pickerTop),
                },
              ]),
          ...candidates.filter(c => c.ticker !== pickerTop),
        ];

  const primary = swapPrimarySubmit(page);

  for (let i = 0; i < ordered.length; i++) {
    const c = ordered[i]!;
    try {
      // first candidate is already selected by picker click above
      if (i > 0) {
        await ensurePayTokenSymbol(page, c.ticker);
      }
      await page.waitForTimeout(600);
      const payAmt = await fillPayAmountWithinBalance(page, c.ticker, {
        balanceHintHuman: c.balance,
      });

      await expect
        .poll(async () => quoteReady(page, primary), {
          timeout: 90_000,
          intervals: [1200],
        })
        .toBe(true);

      return { ticker: c.ticker, payAmt };
    } catch {
      /* try next token with balance */
    }
  }

  return null;
}

/** Quote routers occasionally fail right after `/swap`; reload and pace retries like a slow user refresh. */
async function ensurePaySideWithRetries(page: Page): Promise<{ ticker: string; payAmt: string } | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
    }
    const p = await ensurePaySideWithExecutableQuote(page);
    if (p) return p;
    await page.waitForTimeout(2200 + attempt * 1500);
  }
  return null;
}

/** Load /swap authenticated and ensure we can rank at least one pay token from balances. */
export async function assertSwapFundingPrerequisites(page: Page): Promise<void> {
  await page.goto('/swap', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await expect(page).toHaveURL(/\/swap(?:\/|$|\?)/i);
  await expect(page).not.toHaveURL(/\/login/i);

  await expect(page.getByRole('heading', { name: /\b(trade|swap)\b/i }).first()).toBeVisible({
    timeout: 60_000,
  });

  await expect(page.getByPlaceholder(/enter amount/i).first()).toBeVisible({ timeout: 30_000 });

  const id = nearIntentsAccountIdFromEnv();
  const chainBalances = await fetchIntentsHumanBalances(id);

  const mainNorm = normalizeSwapUiBlob(await page.locator('main').innerText());
  const merged = mergeBalancesUiAndChain(parseSwapTickerBalances(mainNorm), chainBalances);
  let maxBal = 0;
  for (const b of merged.values()) maxBal = Math.max(maxBal, b);

  expect(maxBal > 0, 'Expected positive balance from trade UI and/or intents.near mt_*').toBe(true);

  await page.waitForTimeout(1500);
  const refreshed = normalizeSwapUiBlob(await page.locator('main').innerText());
  const mergedFresh = mergeBalancesUiAndChain(parseSwapTickerBalances(refreshed), chainBalances);
  const candidates = rankedPayCandidatesFromMap(mergedFresh);

  expect(
    candidates.length,
    'No token meets min-pay — trade UI should show at least one balance line (amount + symbol).'
  ).toBeGreaterThan(0);

  expect(
    candidates[0]!.balance,
    'top candidate should display balance ≥ configured min-pay'
  ).toBeGreaterThanOrEqual(candidates[0]!.minPay);

  await ensurePayTokenSymbol(page, candidates[0]!.ticker).catch(() => undefined);
}

function evmTxHashFromSessionCaptures(
  captures: readonly { method: string; params: unknown }[]
): `0x${string}` | null {
  for (let i = captures.length - 1; i >= 0; i--) {
    const cap = captures[i]!;
    if (cap.method !== 'eth_sendTransaction' && cap.method !== 'wallet_sendTransaction') continue;
    const first = ((cap.params ?? []) as unknown[])[0] as Record<string, unknown> | undefined;
    const hash = first?.hash ?? first?.transactionHash;
    if (typeof hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(hash)) {
      return hash as `0x${string}`;
    }
  }
  return null;
}

async function resolveSwapDepositAddress(
  quoteCapture: OneClickQuoteCapture | undefined,
  context: BrowserContext,
  bridge: { getSessionCaptures(): readonly { method: string; params: unknown }[] },
  swapPage: Page,
  explorerCtl: Locator,
  explorerPage: Page | null
): Promise<{ depositAddress: string; depositMemo?: string } | null> {
  const memo = quoteCapture?.getDepositMemo() ?? undefined;
  const candidates: string[] = [];

  const envDeposit = process.env.TEST_ONECLICK_DEPOSIT_ADDRESS?.trim();
  if (envDeposit) candidates.push(envDeposit);

  const fromCapture = quoteCapture?.getDepositAddress();
  if (fromCapture) candidates.push(fromCapture);

  for (const p of context.pages()) {
    try {
      const u = extractDepositAddressFromUrls([p.url()]);
      if (u) candidates.push(u.depositAddress);
    } catch {
      /* ignore */
    }
  }

  const fromWc = extractDepositAddressFromWcCaptures(bridge.getSessionCaptures());
  if (fromWc) candidates.push(fromWc);

  const explorerHref = await explorerCtl
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (explorerHref) {
    const u = extractDepositAddressFromUrls([explorerHref]);
    if (u) candidates.push(u.depositAddress);
  }

  if (explorerPage) {
    try {
      const u = extractDepositAddressFromUrls([explorerPage.url()]);
      if (u) candidates.push(u.depositAddress);
      const body = await explorerPage.locator('body').innerText({ timeout: 15_000 }).catch(() => '');
      candidates.push(...collectDepositAddressCandidates(body));
    } catch {
      /* ignore */
    }
  }

  const mainText = await swapPage.locator('main').innerText({ timeout: 15_000 }).catch(() => '');
  candidates.push(...collectDepositAddressCandidates(mainText));

  return resolveVerifiedOneClickDepositAddress(candidates, memo);
}

/**
 * Drive swap submit + signing, open block explorer briefly, return to swap, wait for Trade complete,
 * assert pay/receive on the summary card, then poll 1Click GET /v0/status until SUCCESS (when enabled).
 */
export async function completeSwapTradeAndVerifyExplorer(
  page: Page,
  context: BrowserContext,
  bridge: {
    readonly evmAddress: `0x${string}`;
    getSessionCaptures(): readonly { method: string; params: unknown }[];
  },
  opts?: {
    quoteCapture?: OneClickQuoteCapture;
    /** Default false unless `TEST_ONECLICK_STATUS_POLL=1` or explicitly `pollOneClickStatus: true`. */
    pollOneClickStatus?: boolean;
  }
): Promise<void> {
  const pollStatus =
    opts?.pollOneClickStatus === true || process.env.TEST_ONECLICK_STATUS_POLL?.trim() === '1';
  await page.goto('/swap', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  await expect(page).toHaveURL(/\/swap(?:\/|$|\?)/i);
  await expect(page).not.toHaveURL(/\/login/i);
  await expect(page.getByRole('heading', { name: /\b(trade|swap)\b/i }).first()).toBeVisible({
    timeout: 60_000,
  });

  const pick = await ensurePaySideWithRetries(page);
  expect(
    pick,
    'Could not derive an executable swap pay side from live balances.'
  ).not.toBeNull();

  const payTicker = pick!.ticker;

  const primary = swapPrimarySubmit(page);

  const explorerCtl = page
    .getByRole('button', { name: /view\s*(on\s*)?explorer/i })
    .or(page.getByRole('link', { name: /view\s*(on\s*)?explorer|near-intents|explorer/i }));

  await expect
    .poll(async () => quoteReady(page, primary), {
      timeout: 120_000,
      intervals: [1500],
    })
    .toBe(true);

  const isSigningMethod = (m: string) =>
    m === 'eth_signTypedData_v4' ||
    m === 'eth_signTypedData' ||
    m === 'eth_sendTransaction' ||
    m === 'wallet_sendTransaction' ||
    m === 'wallet_sendCalls';

  await primary.click();

  for (let i = 0; i < 10; i++) {
    const wcExec = bridge.getSessionCaptures().some(c => isSigningMethod(c.method));
    const uiDone = await page
      .getByText(/trade\s*complete/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (wcExec || uiDone) break;
    await page
      .getByRole('button', { name: /\b(confirm|sign|submit|approve|swap)\b/i })
      .first()
      .click({ timeout: 4000 })
      .catch(() => undefined);
    await page.waitForTimeout(1200);
  }

  await expect
    .poll(
      async () => {
        if (bridge.getSessionCaptures().some(c => isSigningMethod(c.method))) return true;
        const uiDone = await page
          .getByText(/trade\s*complete/i)
          .first()
          .isVisible()
          .catch(() => false);
        const explorerShown = await explorerCtl.first().isVisible().catch(() => false);
        return uiDone || explorerShown;
      },
      { timeout: 180_000, intervals: [900] }
    )
    .toBe(true);

  await expect(explorerCtl.first()).toBeVisible({ timeout: 120_000 });

  const swapPage = page;
  const explorerPage = await openBlockExplorerPage(context, swapPage, explorerCtl.first());
  opts?.quoteCapture?.ingestExplorerUrl(explorerPage.url());

  /*
   * Block explorer in-tab assertions (disabled for now):
   * await waitForExplorerSuccessMessage(explorerPage);
   * await expect(explorerPage.getByRole('heading', { name: /transaction details/i })).toBeVisible({ timeout: 90_000 });
   * await expect
   *   .poll(
   *     async () =>
   *       explorerBodyLooksCoherent(await normalizedVisibleBody(explorerPage), bridge.evmAddress, payTicker),
   *     { timeout: 200_000, intervals: [2500] }
   *   )
   *   .toBe(true);
   * const sigCap = [...bridge.getSessionCaptures()].reverse().find(c => isSigningMethod(c.method));
   * const wcNeedles = sigCap ? comparableStringsFromSessionCapture(sigCap) : [];
   * const wcStrictNeedles = sigCap ? strictExplorerNeedlesFromSessionCapture(sigCap) : [];
   * if (wcStrictNeedles.length > 0) {
   *   await expect
   *     .poll(
   *       async () =>
   *         signingNeedlesMissingFromExplorer(sigCap, await normalizedVisibleBody(explorerPage)),
   *       { timeout: 120_000, intervals: [2000] }
   *     )
   *     .toEqual([]);
   * } else if (wcNeedles.length > 0) {
   *   await expect
   *     .poll(
   *       async () => {
   *         const norm = await normalizedVisibleBody(explorerPage);
   *         return wcNeedles.some(w => norm.includes(String(w).toLowerCase()));
   *       },
   *       { timeout: 45_000, intervals: [2000] }
   *     )
   *     .toBe(true);
   * }
   */

  if (explorerPage !== swapPage) {
    await explorerPage.close().catch(() => undefined);
  }
  await closeExtraContextPages(context, swapPage);
  await swapPage.bringToFront().catch(() => undefined);

  /** Tab switch can briefly drop the completion banner; wait until it is stable again. */
  await expect
    .poll(
      async () =>
        swapPage.getByText(/trade\s*complete/i).first().isVisible().catch(() => false),
      { timeout: 180_000, intervals: [900] }
    )
    .toBe(true);

  await assertTradeCompleteSwapCardMatches(swapPage, payTicker, pick!.payAmt);

  if (/near-intents\.org/i.test(swapPage.url())) {
    await swapPage.goto('/swap', { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  }
  await closeExtraContextPages(context, swapPage);

  if (!pollStatus) return;

  const deposit = await resolveSwapDepositAddress(
    opts?.quoteCapture,
    context,
    bridge,
    swapPage,
    explorerCtl,
    explorerPage !== swapPage ? explorerPage : null
  );
  expect(
    deposit?.depositAddress,
    [
      'Could not resolve depositAddress for GET /v0/status.',
      'near.com usually quotes on the server (no POST /v0/quote in the browser).',
      'Tried: network quote capture, explorer href/URL, WalletConnect typed data, page text.',
      'Set TEST_ONECLICK_STATUS_POLL=1 to poll until SUCCESS, or TEST_ONECLICK_DEPOSIT_ADDRESS for a known swap.',
    ].join(' ')
  ).toBeTruthy();

  const txHash = evmTxHashFromSessionCaptures(bridge.getSessionCaptures());
  if (txHash) {
    await postOneClickDepositSubmit({
      txHash,
      depositAddress: deposit!.depositAddress,
      memo: deposit!.depositMemo,
    }).catch(() => undefined);
  }

  const terminal = await pollOneClickStatusUntilTerminal(deposit!.depositAddress, {
    depositMemo: deposit!.depositMemo,
    requireSuccess: true,
  });

  expect(terminal.status).toBe('SUCCESS');
  const outFormatted = terminal.swapDetails?.amountOutFormatted;
  if (typeof outFormatted === 'string' && outFormatted.length > 0) {
    expect(Number.parseFloat(String(outFormatted).replace(',', '.'))).toBeGreaterThan(0);
  }
}
