import type { Page } from '@playwright/test';
import {
  nearComEthAccountIndicator,
  nearComTopChromeRegion,
  uiTextShowsEthConnection,
} from './near-com.account.locators';

/** How many DOM ancestors to stitch when mining text around the address chip. */
const INDICATOR_ANCESTOR_LEVELS = 20;

/**
 * Candidate “X ETH” values near the connected wallet only (ancestor walk + optional header),
 * avoiding unrelated numbers from the rest of `main`.
 */
export async function collectEthBalanceUiValuesForConnectedWallet(
  page: Page,
  connectedAddress: `0x${string}`
): Promise<number[]> {
  const indicator = nearComEthAccountIndicator(page, connectedAddress);
  const visible = await indicator.isVisible().catch(() => false);
  const seen = new Set<number>();

  if (visible) {
    const fromAncestors = await indicator.evaluate(
      (el, depth: number) => {
        const chunks: string[] = [];
        let n: Element | null = el;
        for (let i = 0; i < depth && n; i++) {
          chunks.push((n as HTMLElement).innerText ?? '');
          n = n.parentElement;
        }
        return chunks.join('\n');
      },
      INDICATOR_ANCESTOR_LEVELS
    );
    for (const v of parseEthBalancesFromUiText(fromAncestors)) {
      seen.add(v);
    }

    /** Asset tables often sit under `main` without repeating the address in the same node */
    try {
      const mainText = await page.locator('main').first().innerText({ timeout: 5_000 });
      for (const v of parseEthBalancesFromUiText(mainText)) {
        seen.add(v);
      }
    } catch {
      /* no main landmark */
    }
  }

  try {
    const chrome = await nearComTopChromeRegion(page).innerText({ timeout: 8_000 });
    if (uiTextShowsEthConnection(chrome, connectedAddress)) {
      for (const v of parseEthBalancesFromUiText(chrome)) {
        seen.add(v);
      }
    }
  } catch {
    /* header missing */
  }

  await nearComCandidatesFromEthAssetRows(page).then(vals => vals.forEach(v => seen.add(v)));

  return [...seen];
}

/** Rows that explicitly mention Ethereum / ETH to drop unrelated tickers. */
async function nearComCandidatesFromEthAssetRows(page: Page): Promise<number[]> {
  const out = new Set<number>();
  try {
    const rows = page.getByRole('row');
    const n = Math.min(await rows.count(), 40);
    for (let i = 0; i < n; i++) {
      const t = await rows.nth(i).innerText({ timeout: 3_000 });
      const lower = t.toLowerCase();
      if (!/\beth\b|\bethereum\b|\(eth\)/.test(lower)) continue;
      for (const v of parseEthBalancesFromUiText(t)) {
        out.add(v);
      }
    }
  } catch {
    /* no table rows */
  }

  return [...out];
}

function scrubUsdAndPercentFragments(line: string): string {
  return line.replace(/\$[\d,]+(?:\.\d+)?/g, ' ').replace(/(?:^|\s)[\d,.]+%/g, ' ');
}

/**
 * Extract numeric ETH quantities from UI blobs (`12.34 ETH`, “Ethereum … 0.01”, etc.).
 */
export function parseEthBalancesFromUiText(text: string): number[] {
  const out = new Set<number>();

  const suffixed = /([\d,]+(?:\.[\d]+)?)\s*(ETH|Ξ)|(?:ETH|Ξ)\s*([\d,]+(?:\.[\d]+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = suffixed.exec(text)) !== null) {
    const raw = (m[1] ?? m[3] ?? '').replace(/,/g, '');
    if (raw) out.add(Number.parseFloat(raw));
  }

  for (const line of text.split(/\r?\n/)) {
    if (!/\beth\b|ethereum|Ξ/i.test(line)) continue;
    const cleaned = scrubUsdAndPercentFragments(line);
    const nums = [...cleaned.matchAll(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+\.\d+)/g)];
    for (const [, raw] of nums) {
      const v = Number.parseFloat(raw.replace(/,/g, ''));
      if (Number.isFinite(v)) out.add(v);
    }
  }

  return [...out];
}

/**
 * Pick UI float closest to JSON-RPC wei→eth value.
 * Absolute tolerance dominates at zero balances; relatives for larger holdings.
 */
export function matchingUiEthBalance(
  rpcEth: number,
  uiValues: readonly number[],
  absTol = 1e-4,
  relativeTol = 0.003
): number | undefined {
  for (const v of uiValues) {
    const ad = Math.abs(v - rpcEth);
    if (ad <= absTol) return v;
    if (rpcEth >= 1e-6 && ad / Math.max(rpcEth, 1e-12) <= relativeTol) return v;
  }
  /**
   * Tiny balances: near.com may aggregate/round differently from raw L1 JSON-RPC snapshots.
   * Allow narrow ratio + absolute milli-ETH slack.
   */
  if (rpcEth > 0 && rpcEth < 5e-4) {
    for (const v of uiValues) {
      const r = Math.max(v / rpcEth, rpcEth / v);
      if (r > 35) continue;
      if (Math.abs(v - rpcEth) <= 8e-4) return v;
    }
  }
  return undefined;
}
