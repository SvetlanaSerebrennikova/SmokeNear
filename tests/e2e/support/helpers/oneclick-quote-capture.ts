import type { Page } from '@playwright/test';
import type { QuoteResponseBody } from '../../../support/oneclick-client';
import {
  extractDepositAddressFromJson,
  extractDepositAddressFromUrls,
  isOneClickApiUrl,
  isOneClickQuotePath,
} from '../../../support/oneclick-client';

export type OneClickQuoteCapture = {
  getDepositAddress: () => string | null;
  getDepositMemo: () => string | null;
  getLastWetQuote: () => QuoteResponseBody | null;
  ingestExplorerUrl: (url: string) => void;
  dispose: () => void;
};

function isQuoteCaptureResponse(url: string, method: string): boolean {
  if (method !== 'POST') return false;
  try {
    const { pathname } = new URL(url);
    if (isOneClickQuotePath(pathname)) return true;
    if (/near\.com$/i.test(new URL(url).hostname) && /\/api\//i.test(pathname)) {
      return /(quote|swap|intents|oneclick|1click|solver)/i.test(pathname);
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Records wet quote responses (`quote.depositAddress`) from 1Click or near.com BFF during /swap.
 */
export function attachOneClickQuoteCapture(page: Page): OneClickQuoteCapture {
  let depositAddress: string | null = null;
  let depositMemo: string | null = null;
  let lastWetQuote: QuoteResponseBody | null = null;

  const apply = (parsed: ReturnType<typeof extractDepositAddressFromJson>) => {
    if (!parsed) return;
    depositAddress = parsed.depositAddress;
    depositMemo = parsed.depositMemo ?? null;
    if (parsed.quoteResponse) {
      lastWetQuote = parsed.quoteResponse;
    }
  };

  const onResponse = async (response: import('@playwright/test').Response) => {
    const req = response.request();
    const url = response.url();
    if (!isOneClickApiUrl(url) && !isQuoteCaptureResponse(url, req.method())) return;
    if (!response.ok()) return;
    try {
      const json: unknown = await response.json();
      apply(extractDepositAddressFromJson(json));
    } catch {
      /* non-JSON */
    }
  };

  page.on('response', onResponse);

  return {
    getDepositAddress: () => depositAddress,
    getDepositMemo: () => depositMemo,
    getLastWetQuote: () => lastWetQuote,
    ingestExplorerUrl(url: string) {
      const fromUrl = extractDepositAddressFromUrls([url]);
      if (fromUrl) {
        depositAddress = fromUrl.depositAddress;
        if (fromUrl.depositMemo) depositMemo = fromUrl.depositMemo;
      }
    },
    dispose() {
      page.off('response', onResponse);
    },
  };
}
