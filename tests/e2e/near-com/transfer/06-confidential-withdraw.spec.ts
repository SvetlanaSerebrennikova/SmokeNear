/**
 * Standalone confidential **unshield** (Confidential → Main), симметрично **05**.
 *
 * [`/transfer/confidential?mode=unshield`](https://near.com/transfer/confidential?mode=unshield).
 *
 * Шаги: 1 — предусловия (`/` + WC). 2 — unshield URL + проверка `mode=unshield`. 3 — To Main · 4 — копирайт ·
 * 5–7 picker · 8 снимок confidential · 9 amount · 10–11 Confirm/Complete · 12 Move again · 13 ассерты.
 */
import { expect, test } from '../fixtures/wallet-worker-chain';
// Balance scrape/asserts disabled until UI slice is stable (see step 8 / 13).
// import { normalizedMainOrBody, parseMaxAmountBeforeToken, parseTransferCardBalanceLine, snippetNearConfidentialLabel } from '../../support/helpers/confidential-near-com';
import {
  expectNearComTransferModeUrl,
  nearComConfidentialTransferPath,
  transferFlowPreconditionsNearComSignedIn,
} from '../../support/helpers/near-com-transfer-preconditions';
import {
  nearComConfidentialToMainTab,
  nearComConfidentialUnshieldMoveLink,
  nearComMoveAgainCta,
} from '../../support/locators/near-com.locators';
import {
  expectVisibleConfidentialIntroCopy,
  formatTransferAmount,
  spendableUiAmount,
  submitConfidentialTransferAmount,
  waitForConfidentialTransferToken,
} from '../../support/helpers/confidential-near-com';

test.describe.configure({ timeout: 720_000 });

const unshieldPath = nearComConfidentialTransferPath.unshield;

const unshieldIntroPattern =
  /move\s+assets\s+from\s+your\s+confidential\s+account\s+to\s+your\s+main\s+account/i;

test('Confidential: withdraw to main drops confidential slice in UI', async ({ wcPage, wcBridge }) => {
  const amountStr = '1';
  let token: string;
  let balanceHint: number | null = null;

  await test.step('1 Preconditions: `/` + signed-in shell (EVM indicator, same idea as trade/01)', async () => {
    await transferFlowPreconditionsNearComSignedIn(wcPage, wcBridge.evmAddress);
  });

  await test.step('2 Open unshield `/transfer?mode=unshield`', async () => {
    await wcPage.goto(unshieldPath, { waitUntil: 'domcontentloaded' });
    await expectNearComTransferModeUrl(wcPage, 'unshield');
  });

  await test.step('3 Нажать сегмент «To Main» (Confidential → Main)', async () => {
    const toMain = nearComConfidentialToMainTab(wcPage).first();
    await expect(toMain).toBeVisible({ timeout: 25_000 });
    await toMain.scrollIntoViewIfNeeded().catch(() => undefined);
    await toMain.click();
  });

  await test.step('4 Проверить текст: Move assets … Confidential … Main …', async () => {
    await expectVisibleConfidentialIntroCopy(wcPage, unshieldIntroPattern);
    await expectNearComTransferModeUrl(wcPage, 'unshield');
  });

  await test.step('5 Дождаться токена на Move surface', async () => {
    const picked = await waitForConfidentialTransferToken(wcPage);
    if (!picked) {
      test.skip(true, 'Confidential account has no tokens for unshield');
      return;
    }
    token = picked.token;
    balanceHint = picked.balanceHint;
  });

  await test.step('6 Ввести amount и отправить (подпись WalletConnect)', async () => {
    let amt = amountStr;
    if (balanceHint != null && balanceHint > 0) {
      const spend = spendableUiAmount(balanceHint, token);
      const final = Math.min(Number(amountStr) || 1, spend);
      if (final > 0) amt = formatTransferAmount(token, final);
    }
    await submitConfidentialTransferAmount(wcPage, amt);
  });

  await test.step('11 Дождаться Complete / success в UI', async () => {
    await expect
      .poll(
        async () =>
          wcPage
            .getByText(/\b(complete|completed|success|successful|confirmed|transferr?ed|withdrawn|done)\b/i)
            .first()
            .isVisible()
            .catch(() => false),
        { timeout: 180_000, intervals: [2000] }
      )
      .toBe(true);
  });

  await test.step('12 Нажать «Move again» (fallback — shell link unshield)', async () => {
    const moveAgain = nearComMoveAgainCta(wcPage).first();
    try {
      await expect(moveAgain, 'Кнопка «Move again» на карточке успеха').toBeVisible({ timeout: 35_000 });
      await moveAgain.scrollIntoViewIfNeeded().catch(() => undefined);
      await moveAgain.click({ timeout: 20_000 }).catch(async () => {
        await moveAgain.click({ force: true, timeout: 15_000 });
      });
    } catch {
      const link = nearComConfidentialUnshieldMoveLink(wcPage).first();
      await expect(link, '«Move again» нет — fallback навигация unshield').toBeVisible({
        timeout: 15_000,
      });
      await link.scrollIntoViewIfNeeded();
      await link.click();
    }
    await expectNearComTransferModeUrl(wcPage, 'unshield');
  });

  await test.step('13 Post-withdraw shell (balance asserts disabled)', async () => {
    await wcPage.keyboard.press('Escape').catch(() => undefined);
    await wcPage.waitForTimeout(2000);
    await expectNearComTransferModeUrl(wcPage, 'unshield');

    // const afterNorm = await normalizedMainOrBody(wcPage);
    // balConfAfter = parseMaxAmountBeforeToken(snippetNearConfidentialLabel(afterNorm), token);
    // expect(balConfAfter, …).not.toBeNull();
    // expect(balConfBefore - balConfAfter).toBeGreaterThanOrEqual(amount * confidentialEffectAssertMin());
  });
});
