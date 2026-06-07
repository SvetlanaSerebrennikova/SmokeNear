import type { Page } from '@playwright/test';

/** Walk DOM + shadow roots looking for a `wc:` URI string. */
function scanDomForWcUri(): string | null {
  const st: (ParentNode | ShadowRoot)[] = [document.documentElement];
  while (st.length) {
    const n = st.pop()!;
    for (const ch of [...n.childNodes]) {
      if (ch.nodeType === Node.TEXT_NODE) {
        const t = (ch.textContent || '').trim();
        if (t.startsWith('wc:')) return t;
      } else if (ch instanceof Element) {
        const el = ch as HTMLElement & { value?: string };
        if (typeof el.value === 'string' && el.value.trim().startsWith('wc:')) return el.value.trim();
        if (ch instanceof HTMLAnchorElement && ch.href.startsWith('wc:')) return ch.href.trim();
        st.push(ch);
        if (el.shadowRoot) st.push(el.shadowRoot);
      }
    }
  }
  return null;
}

/** Scan every frame (WalletConnect modal often lives in iframes). */
export async function readWalletConnectUriFromPage(page: Page, timeoutMs = 90_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const copy = page.getByRole('button', { name: /copy|link/i }).first();
    if (await copy.isVisible({ timeout: 250 }).catch(() => false)) {
      await copy.click().catch(() => undefined);
      try {
        const clip = await page.evaluate(() => navigator.clipboard.readText());
        if (clip.trim().startsWith('wc:')) return clip.trim();
      } catch {
        /* clipboard read needs prior permission grant */
      }
    }

    for (const frame of page.frames()) {
      const hit = await frame.evaluate(scanDomForWcUri).catch(() => null);
      if (hit && hit.startsWith('wc:')) return hit;
    }

    await page.waitForTimeout(400);
  }

  throw new Error(
    `No WalletConnect pairing string (wc:…) within ${timeoutMs} ms — run headed and press “Copy link” in the modal if needed.`
  );
}
