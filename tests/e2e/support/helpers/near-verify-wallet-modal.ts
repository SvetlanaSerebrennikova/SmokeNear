import type { Page } from '@playwright/test';

/**
 * near.com may show “Verify your wallet” requiring `personal_sign` (answered by WC bridge).
 * Wait for dismissal or balances stay blurred / hidden.
 */
export async function dismissVerifyWalletModalIfPresent(page: Page) {
  const title = page.getByText(/verify\s+your\s+wallet/i).first();

  await title.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => undefined);
  if (!(await title.isVisible().catch(() => false))) {
    return;
  }

  const dialog = page.getByRole('dialog');
  const dlg = (await dialog.isVisible().catch(() => false))
    ? dialog.getByRole('button', { name: /verify wallet/i }).first()
    : page.getByRole('button', { name: /verify wallet/i }).first();

  await dlg.click({ timeout: 20_000 });
  await title.waitFor({ state: 'hidden', timeout: 120_000 });
}
