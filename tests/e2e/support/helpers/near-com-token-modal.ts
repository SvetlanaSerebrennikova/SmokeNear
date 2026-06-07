import type { Locator } from '@playwright/test';

/**
 * Balance fragment in a token row (`10`, `0.95`, `120.7226`). Avoid matching modal chrome only.
 */
const ROW_HAS_BALANCE = /\d+(?:[.,]\d+)?/;
const ROW_HAS_TICKERISH = /\b[A-Z][A-Z0-9]{1,11}\b/;

/** near.com Move / some pickers: full-row hit target (`absolute inset-0`), a11y name “Select item”. */
const SELECT_ITEM_NAME = /^select item$/i;

/** Exclude rows that are (or wrap) the search field — clicking those hits the search input. */
function excludeSearchChrome(modal: Locator, row: Locator): Locator {
  const searchField = modal.locator(
    'input[placeholder*="search" i], input[type="search"], [role="searchbox"]'
  );
  return row.filter({ hasNot: searchField.first() });
}

/**
 * Legacy pickers: `listbox > option`, or focusable row `div`s **inside** the listbox (not modal-wide).
 */
function pickableYourTokenRowsLegacy(modal: Locator): Locator {
  const balance = ROW_HAS_BALANCE;
  const ticker = ROW_HAS_TICKERISH;

  const listbox = modal.locator('[role="listbox"]').first();

  const fromListbox = excludeSearchChrome(
    modal,
    listbox.getByRole('option').filter({ hasText: balance }).filter({ hasText: ticker })
  ).filter({ hasNotText: /search tokens/i });

  const divLikeInListbox = excludeSearchChrome(
    modal,
    listbox
      .locator('div[tabindex="0"], div[role="button"], button[type="button"]')
      .filter({ hasText: balance })
      .filter({ hasText: ticker })
      .filter({ hasNot: listbox.getByRole('button', { name: SELECT_ITEM_NAME }) })
  ).filter({ hasNotText: /search tokens/i });

  const orphanOptions = excludeSearchChrome(
    modal,
    modal.getByRole('option').filter({ hasText: balance }).filter({ hasText: ticker })
  ).filter({ hasNotText: /search tokens/i });

  return fromListbox.or(divLikeInListbox).or(orphanOptions);
}

/**
 * Prefer full-row overlay buttons (“Select item”) when present — they are the real click target and
 * don’t duplicate `option` rows in `.or()` unions.
 */
export async function resolvePickableYourTokenHitTargets(modal: Locator): Promise<Locator> {
  const listbox = modal.locator('[role="listbox"]').first();

  const inListbox = excludeSearchChrome(modal, listbox.getByRole('button', { name: SELECT_ITEM_NAME }));
  if ((await inListbox.count()) > 0) {
    return inListbox;
  }

  const inDialog = excludeSearchChrome(modal, modal.getByRole('button', { name: SELECT_ITEM_NAME }));
  if ((await inDialog.count()) > 0) {
    return inDialog;
  }

  return pickableYourTokenRowsLegacy(modal);
}

/**
 * First row under **Your tokens** (prefer `$` fiat hint when present — parity with swap flows).
 * Async: chooses “Select item” pool vs legacy after a live DOM check.
 */
export async function firstTokenRowAfterYourTokensLabel(modal: Locator): Promise<Locator> {
  const pool = await resolvePickableYourTokenHitTargets(modal);
  const withFiat = pool.filter({ hasText: /\$/ });
  if ((await withFiat.count()) > 0) {
    return withFiat.first();
  }
  return pool.first();
}

/** Nth row (1-based): first token == `n === 1`. */
export async function nthTokenRowAfterYourTokensLabel(modal: Locator, n: number): Promise<Locator> {
  const pool = await resolvePickableYourTokenHitTargets(modal);
  return pool.nth(Math.max(0, n - 1));
}

export async function tokenPickerRowScrapeText(row: Locator): Promise<string> {
  return row.evaluate(el => {
    const balanceRe = /\d+(?:[.,]\d+)?/;
    const tickerRe = /\b[A-Z][A-Z0-9]{1,11}\b/;
    const self = el as HTMLElement;
    const bits: string[] = [];
    bits.push(self.innerText || '', self.textContent || '', self.getAttribute('aria-label') || '');
    self.querySelectorAll('[aria-label]').forEach(n => {
      bits.push(n.getAttribute('aria-label') || '');
    });

    const joined = bits.join(' \n ').trim();
    const looksLikeOverlayOnly =
      self.tagName === 'BUTTON' &&
      (/^select\s*item$/i.test(joined) || joined.length < 4);

    if (looksLikeOverlayOnly) {
      let p: HTMLElement | null = self.parentElement;
      for (let depth = 0; depth < 12 && p; depth++, p = p.parentElement) {
        const t = (p.innerText || '').trim();
        if (t.length > 6 && balanceRe.test(t) && tickerRe.test(t)) {
          bits.push(t);
          break;
        }
      }
    }

    return bits.join(' \n ');
  });
}
