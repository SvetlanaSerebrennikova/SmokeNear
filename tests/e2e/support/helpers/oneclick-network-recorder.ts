import { expect, type Page } from '@playwright/test';
import {
  isOneClickApiUrl,
  isOneClickQuotePath,
  isOneClickTokensPath,
} from '../../../support/oneclick-client';

export type OneClickRecordedCall = {
  method: string;
  url: string;
  path: string;
  status: number;
  resourceType: string;
};

function isStaticAssetPath(pathname: string): boolean {
  return /\.(js|css|png|jpe?g|gif|webp|woff2?|svg|ico|map)(\?|$)/i.test(pathname);
}

function shouldRecordResponse(url: string, resourceType: string): boolean {
  if (isOneClickApiUrl(url)) return true;
  if (!['fetch', 'xhr'].includes(resourceType)) return false;
  try {
    const { hostname, pathname } = new URL(url);
    if (/near\.com$/i.test(hostname) && !isStaticAssetPath(pathname)) return true;
  } catch {
    return false;
  }
  return false;
}

export function attachOneClickNetworkRecorder(page: Page): {
  readonly calls: OneClickRecordedCall[];
  waitForPaths: (paths: RegExp | string[], timeoutMs?: number) => Promise<void>;
  sawTokensCatalog: () => boolean;
  sawQuoteRequest: () => boolean;
  debugSummary: () => string;
  dispose: () => void;
} {
  const calls: OneClickRecordedCall[] = [];

  const onResponse = async (response: import('@playwright/test').Response) => {
    const req = response.request();
    const url = response.url();
    if (!shouldRecordResponse(url, req.resourceType())) return;
    const { pathname } = new URL(url);
    calls.push({
      method: req.method(),
      url,
      path: pathname,
      status: response.status(),
      resourceType: req.resourceType(),
    });
  };

  page.on('response', onResponse);

  const hasPath = (fragment: string | RegExp): boolean =>
    calls.some(c => (typeof fragment === 'string' ? c.path.includes(fragment) : fragment.test(c.path)));

  const debugSummary = (): string => {
    if (!calls.length) return 'Recorded fetch/xhr: (none)';
    return `Recorded fetch/xhr: ${calls
      .slice(-25)
      .map(c => `${c.method} ${c.path} [${c.resourceType}] ${c.status}`)
      .join(' | ')}`;
  };

  return {
    calls,
    async waitForPaths(paths: RegExp | string[], timeoutMs = 120_000) {
      const list = Array.isArray(paths) ? paths : [paths];
      await expect
        .poll(
          () => list.every(p => (typeof p === 'string' ? hasPath(p) : hasPath(p))),
          {
            timeout: timeoutMs,
            intervals: [500, 1000, 2000],
            message: () => `Swap API traffic not seen. ${debugSummary()}`,
          }
        )
        .toBe(true);
    },
    sawTokensCatalog(): boolean {
      return calls.some(c => isOneClickTokensPath(c.path));
    },
    sawQuoteRequest(): boolean {
      return calls.some(c => c.method === 'POST' && isOneClickQuotePath(c.path));
    },
    debugSummary,
    dispose() {
      page.off('response', onResponse);
    },
  };
}
