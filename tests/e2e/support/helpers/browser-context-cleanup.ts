import type { BrowserContext, Page } from '@playwright/test';

/** Closes every tab in the context except `keep` (e.g. near-intents popups after swap). */
export async function closeExtraContextPages(
  context: BrowserContext,
  keep: Page
): Promise<void> {
  for (const p of context.pages()) {
    if (p === keep) continue;
    await p.close().catch(() => undefined);
  }
}
