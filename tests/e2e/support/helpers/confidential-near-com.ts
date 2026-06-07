import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { firstTokenRowAfterYourTokensLabel, nthTokenRowAfterYourTokensLabel, tokenPickerRowScrapeText } from './near-com-token-modal';
import {
  canonicalScrapedSymbol,
  inferTickerFromUiScrapeLine,
  isUiScrapeNoiseTicker,
  maxParsedBalanceForSymbol,
  normalizeSwapUiBlob,
  parseSwapTickerBalances,
} from './trade-token-balances';

/** Canonical symbol key scraped from UI (lowercase). */
export type PortfolioToken = string;

export function parseEnvPortfolioToken(raw: string | undefined): string | null {
  const t = (raw ?? '').trim().toLowerCase();
  return t || null;
}

/** Prefer `TEST_CONFIDENTIAL_TOKEN`, then symbols ordered by scraped balance (highest first). */
export function orderedSymbolsFromScrapedBalances(normRaw: string, prefer: string | null): string[] {
  const m = parseSwapTickerBalances(normalizeSwapUiBlob(normRaw));
  const byBal = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  if (!prefer) return byBal;
  const rest = byBal.filter(s => s !== prefer);
  return byBal.includes(prefer) ? [prefer, ...rest] : [prefer, ...byBal];
}

async function tokenTriggerInTransferModal(modal: Locator): Promise<Locator | null> {
  const byTestId = modal.getByTestId('select-assets-input').first();
  if (await byTestId.isVisible().catch(() => false)) return byTestId;

  const moveThisToken = modal
    .getByRole('button', { name: /move this token/i })
    .or(modal.getByRole('combobox', { name: /move this token/i }))
    .first();
  if (await moveThisToken.isVisible().catch(() => false)) return moveThisToken;

  const moveLabel = modal.getByText(/move this token/i).first();
  if (await moveLabel.isVisible().catch(() => false)) {
    const btn = moveLabel.locator('xpath=ancestor::button[1]');
    if (await btn.isVisible().catch(() => false)) return btn;
    const row = moveLabel.locator('xpath=ancestor::*[self::button or @role="button"][1]');
    if (await row.isVisible().catch(() => false)) return row;
  }

  const amt = modal
    .getByPlaceholder(/amount|enter|0(\.|,)/i)
    .or(modal.locator('input[inputmode="decimal"]'))
    .first();
  if (!(await amt.isVisible().catch(() => false))) return null;
  const nextBtn = amt.locator('xpath=following::button[@type="button"][1]');
  if (await nextBtn.isVisible().catch(() => false)) return nextBtn;
  return null;
}

export function normalizeUiBlob(t: string): string {
  return t.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function parseMaxAmountBeforeToken(normLower: string, token: string): number | null {
  return maxParsedBalanceForSymbol(normLower, token);
}

/**
 * Move card on `/transfer/confidential?…`: line **Balance 12.34 trx** (norm lower).
 * Move card on confidential transfer still shows the pot balance line.
 */
export function parseTransferCardBalanceLine(normLower: string): { amount: number; symbol: string } | null {
  const m = normLower.match(/\bbalance\s+(\d+(?:[.,]\d+)?)\s+([a-z][a-z0-9]{1,11})\b/i);
  if (!m) return null;
  const symRaw = m[2]!.toLowerCase();
  if (isUiScrapeNoiseTicker(symRaw)) return null;
  const amount = Number.parseFloat(m[1]!.replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return { amount, symbol: canonicalScrapedSymbol(symRaw) };
}

export function formatTransferAmount(_token: string, n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 0.01) return `${Math.floor(n * 1_000_000) / 1_000_000}`;
  if (n >= 0.0001) return `${Math.floor(n * 1e8) / 1e8}`;
  return `${Math.floor(n * 1e12) / 1e12}`;
}

function confidentialSpendFraction(): number {
  const n = Number(process.env.TEST_CONFIDENTIAL_SPEND_FRACTION ?? '');
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.4;
}

function confidentialBalanceReserve(): number {
  const r = Number(
    process.env.TEST_CONFIDENTIAL_BALANCE_RESERVE ?? process.env.TEST_CONFIDENTIAL_TOKEN_RESERVE ?? ''
  );
  return Number.isFinite(r) && r >= 0 ? r : 0;
}

export function spendableUiAmount(bal: number, _token: string): number {
  const frac = confidentialSpendFraction();
  const reserve = confidentialBalanceReserve();
  const raw = bal * frac - reserve;
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

/** Minimum fraction of transferred amount we still expect visible in UI after fees. */
export function confidentialEffectAssertMin(): number {
  const n = Number(process.env.TEST_CONFIDENTIAL_EFFECT_ASSERT_MIN ?? '');
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.78;
}

export function pickDepositTokenAndAmount(
  normLower: string,
  requestedAmount: number,
  prefer: string | null
): { token: string; amount: number; amountStr: string } | null {
  const minXfer = Number(
    String(process.env.TEST_CONFIDENTIAL_MIN_TRANSFER ?? '').trim() || '0.005'
  );
  const order = orderedSymbolsFromScrapedBalances(normLower, prefer);

  for (const token of order) {
    const bal = parseMaxAmountBeforeToken(normLower, token);
    if (bal == null || bal < minXfer) continue;
    const pool = spendableUiAmount(bal, token);
    if (pool + 1e-15 < minXfer) continue;
    const finalAmt = Math.max(minXfer, Math.min(requestedAmount, pool));
    if (finalAmt + 1e-15 <= bal && finalAmt >= minXfer && Number.isFinite(finalAmt)) {
      return { token, amount: finalAmt, amountStr: formatTransferAmount(token, finalAmt) };
    }
  }
  return null;
}

export function pickWithdrawAmountForToken(
  normSnippet: string,
  token: string,
  requestedAmount: number
): { amount: number; amountStr: string } | null {
  const minXfer = Number(
    String(process.env.TEST_CONFIDENTIAL_MIN_TRANSFER ?? '').trim() || '0.005'
  );
  const bal = parseMaxAmountBeforeToken(normSnippet, token);
  if (bal == null || bal < minXfer) return null;
  const pool = spendableUiAmount(bal, token);
  if (pool + 1e-15 < minXfer) return null;
  const finalAmt = Math.max(minXfer, Math.min(requestedAmount, pool));
  if (finalAmt + 1e-15 <= bal && finalAmt >= minXfer && Number.isFinite(finalAmt)) {
    return { amount: finalAmt, amountStr: formatTransferAmount(token, finalAmt) };
  }
  return null;
}

/** UI slice near confidential / private labels (balances often rendered there). */
export function snippetNearConfidentialLabel(normLower: string): string {
  const cues = [
    'confidential account',
    'confidential balance',
    'confidential holdings',
    'confidential wallet',
    'private balance',
    'confidential',
  ];
  let bestIdx = -1;
  for (const k of cues) {
    const i = normLower.indexOf(k);
    if (i >= 0 && (bestIdx < 0 || i < bestIdx)) bestIdx = i;
  }
  if (bestIdx < 0) return normLower.slice(0, 2500);
  return normLower.slice(bestIdx, Math.min(normLower.length, bestIdx + 1800));
}

export async function normalizedMainOrBody(page: Page): Promise<string> {
  try {
    return normalizeUiBlob(await page.locator('main').first().innerText({ timeout: 15_000 }));
  } catch {
    return normalizeUiBlob((await page.textContent('body')) ?? '');
  }
}

export async function tryOpenTransferToConfidentialUi(page: Page): Promise<boolean> {
  const namePatterns = [
    /transfer\s+.*\s+to\s+confidential/i,
    /move\s+.*\s+to\s+confidential/i,
    /deposit\s+.*\s+to\s+confidential/i,
    /add\s+.*\s+to\s+confidential/i,
    /fund\s+.*\s+confidential/i,
    /send\s+.*\s+to\s+confidential/i,
    /send\s+this\s+token/i,
  ];

  const clickIfVisible = async (locator: Locator): Promise<boolean> => {
    const el = locator.first();
    if (await el.isVisible().catch(() => false)) {
      await el.click();
      return true;
    }
    return false;
  };

  for (const p of namePatterns) {
    if (await clickIfVisible(page.getByRole('button', { name: p }))) return true;
    if (await clickIfVisible(page.getByRole('link', { name: p }))) return true;
  }

  const loose = page.getByText(
    /\btransfer\b[\s\S]{0,48}\bconfidential\b|\bdeposit\b[\s\S]{0,48}\bconfidential\b/i
  );
  if (await clickIfVisible(loose)) return true;

  return false;
}

export async function tryOpenTransferFromConfidentialToMainUi(page: Page): Promise<boolean> {
  const namePatterns = [
    /transfer\s+.*\s+to\s+main/i,
    /move\s+.*\s+to\s+main/i,
    /withdraw\s+.*\s+to\s+main/i,
    /withdraw\s+.*\s+from\s+confidential/i,
    /send\s+.*\s+to\s+main/i,
    /transfer\s+.*\s+to\s+public/i,
    /withdraw\s+.*\s+public/i,
    /move\s+.*\s+to\s+public/i,
  ];

  const clickIfVisible = async (locator: Locator): Promise<boolean> => {
    const el = locator.first();
    if (await el.isVisible().catch(() => false)) {
      await el.click();
      return true;
    }
    return false;
  };

  for (const p of namePatterns) {
    if (await clickIfVisible(page.getByRole('button', { name: p }))) return true;
    if (await clickIfVisible(page.getByRole('link', { name: p }))) return true;
  }

  const loose = page.getByText(
    /\b(withdraw|transfer)\b[\s\S]{0,56}\b(main|public)\b|\b(withdraw)\b[\s\S]{0,40}\bconfidential\b[\s\S]{0,32}\b(main|public)?/i
  );
  if (await clickIfVisible(loose)) return true;

  return false;
}

export async function submitAmountInOpenDialog(page: Page, amountStr: string): Promise<void> {
  const box = page
    .getByPlaceholder(/amount|0(\.|,)0/i)
    .or(page.locator('input[inputmode="decimal"]'))
    .or(page.locator('input[type="number"]'))
    .first();

  if (!(await box.isVisible().catch(() => false))) {
    const useMax = page.getByRole('button', { name: /use max/i }).first();
    if (await useMax.isVisible().catch(() => false)) {
      await useMax.click();
      const go = page
        .getByRole('button', { name: /confirm|transfer|deposit|submit|continue|review|next|move/i })
        .filter({ hasNotText: /cancel|back|close|enter amount|use max|to main|to confidential/i });
      await expect(go.last()).toBeEnabled({ timeout: 60_000 });
      await go.last().click();
      return;
    }
  }

  await expect(box).toBeVisible({ timeout: 30_000 });
  await box.click().catch(() => undefined);
  await box.fill('');
  await box.fill(amountStr);

  const go = page
    .getByRole('button', { name: /confirm|transfer|deposit|submit|continue|review|next|move/i })
    .filter({ hasNotText: /cancel|back|close|enter amount|use max|to main|to confidential/i });
  await expect(go.last()).toBeEnabled({ timeout: 60_000 });
  await go.last().click();
}

/** Fill amount on `/transfer?mode=…` and click the primary CTA (not “Enter amount” / “Use max”). */
export async function submitConfidentialTransferAmount(page: Page, amountStr: string): Promise<void> {
  await submitAmountInOpenDialog(page, amountStr);
}

/** Wait until Move surface shows a funded token or an explicit empty state. */
export async function waitForConfidentialTransferToken(page: Page): Promise<{
  token: string;
  balanceHint: number | null;
} | null> {
  let picked: { token: string | null; balanceHint: number | null } = { token: null, balanceHint: null };

  try {
    await expect
      .poll(
        async () => {
          if (
            await page
              .getByText(/no tokens in main account|no tokens available/i)
              .first()
              .isVisible()
              .catch(() => false)
          ) {
            return 'empty';
          }
          picked = await selectFirstTokenInTransferDialog(page);
          return picked.token ?? '';
        },
        { timeout: 90_000, intervals: [1500, 2000, 3000] }
      )
      .not.toBe('empty');
  } catch {
    if (
      await page
        .getByText(/no tokens in main account|no tokens available/i)
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      return null;
    }
  }

  if (!picked.token) return null;
  return { token: picked.token, balanceHint: picked.balanceHint };
}

/**
 * Human-like transfer token selection:
 * open token picker inside the transfer surface (dialog or `main` on `/transfer/confidential?...`).
 */
export async function selectFirstTokenInTransferDialog(page: Page): Promise<{
  token: string | null;
  balanceHint: number | null;
}> {
  const mainNorm = await normalizedMainOrBody(page);
  const onCard = parseTransferCardBalanceLine(mainNorm);
  if (onCard && onCard.amount > 0) {
    return { token: onCard.symbol, balanceHint: onCard.amount };
  }

  const roots = [page.getByRole('dialog').first(), page.locator('main').first()];
  let picker: Locator | null = null;
  for (const root of roots) {
    if (!(await root.isVisible().catch(() => false))) continue;
    const p = await tokenTriggerInTransferModal(root);
    if (p && (await p.isVisible().catch(() => false))) {
      picker = p;
      break;
    }
  }

  if (!picker) {
    return { token: null, balanceHint: null };
  }

  await picker.click({ timeout: 10_000 }).catch(() => undefined);
  const tokenModal = page.getByRole('dialog').last();
  await expect(tokenModal.getByText(/select token/i).first()).toBeVisible({ timeout: 20_000 });
  await tokenModal
    .getByText(/your tokens/i)
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => undefined);

  let row: Locator | null = null;
  let firstText = '';
  for (let k = 1; k <= 15; k++) {
    const candidate = await nthTokenRowAfterYourTokensLabel(tokenModal, k);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    const raw = await tokenPickerRowScrapeText(candidate);
    const t = inferTickerFromUiScrapeLine(raw);
    if (t) {
      row = candidate;
      firstText = normalizeUiBlob(raw);
      break;
    }
  }
  if (!row) {
    const fallback = await firstTokenRowAfterYourTokensLabel(tokenModal);
    if (await fallback.isVisible().catch(() => false)) {
      const raw = await tokenPickerRowScrapeText(fallback);
      const t = inferTickerFromUiScrapeLine(raw);
      if (t) {
        row = fallback;
        firstText = normalizeUiBlob(raw);
      }
    }
  }
  if (!row) {
    return { token: null, balanceHint: null };
  }

  await row.click({ timeout: 10_000 });

  const symGuess = inferTickerFromUiScrapeLine(firstText);
  const token = symGuess != null ? canonicalScrapedSymbol(symGuess) : null;

  let balanceHint: number | null = null;
  if (token != null) {
    const v = parseMaxAmountBeforeToken(firstText, token);
    if (v != null && Number.isFinite(v)) balanceHint = v;
  }

  return { token, balanceHint };
}
