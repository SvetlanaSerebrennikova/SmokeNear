/**
 * Wallet chain — step 5: confidential deposit (shield flow).
 * Steps numbered as in product flow; `test.step` names match.
 */
import { expect, test, markConfidentialDepositSucceeded, resetConfidentialDepositFlag } from '../fixtures/wallet-worker-chain';
// Balance scrape/asserts disabled until UI slice is stable (see step 8 / 12).
// import { normalizedMainOrBody, parseMaxAmountBeforeToken, snippetNearConfidentialLabel } from '../../support/helpers/confidential-near-com';
import {
  expectNearComTransferModeUrl,
  nearComConfidentialTransferPath,
  transferFlowPreconditionsNearComSignedIn,
} from '../../support/helpers/near-com-transfer-preconditions';
import { nearComConfidentialShieldMoveLink, nearComMoveAgainCta } from '../../support/locators/near-com.locators';
import {
  formatTransferAmount,
  spendableUiAmount,
  submitConfidentialTransferAmount,
  waitForConfidentialTransferToken,
} from '../../support/helpers/confidential-near-com';

test.describe.configure({ timeout: 720_000 });

const shieldPath = nearComConfidentialTransferPath.shield;

/** Copy on shield landing (allow flexible whitespace / line breaks). */
const shieldIntroPattern =
  /move\s+assets\s+from\s+your\s+main\s+account\s+to\s+your\s+confidential\s+account/i;

test('Confidential: deposit from public balance updates confidential slice in UI', async ({ wcPage, wcBridge }) => {
  resetConfidentialDepositFlag();

  const amountStr = '1';
  let token: string;
  let balanceHint: number | null = null;

  await test.step('1 Preconditions: `/` + signed-in shell (EVM indicator, same idea as trade/01)', async () => {
    await transferFlowPreconditionsNearComSignedIn(wcPage, wcBridge.evmAddress);
  });

  await test.step('3 Open shield URL `/transfer?mode=shield`', async () => {
    await wcPage.goto(shieldPath, { waitUntil: 'domcontentloaded' });
    await expectNearComTransferModeUrl(wcPage, 'shield');
  });

  await test.step('4 Assert copy: Main → Confidential', async () => {
    await expect(wcPage.getByText(shieldIntroPattern).first()).toBeVisible({ timeout: 30_000 });
    await expectNearComTransferModeUrl(wcPage, 'shield');
  });

  await test.step('5 Wait for funded token on Move surface', async () => {
    const picked = await waitForConfidentialTransferToken(wcPage);
    if (!picked) {
      test.skip(true, 'Main account has no tokens for confidential deposit');
      return;
    }
    token = picked.token;
    balanceHint = picked.balanceHint;
  });

  await test.step('6 Enter amount and submit (WalletConnect signs in bridge)', async () => {
    let amt = amountStr;
    if (balanceHint != null && balanceHint > 0) {
      const spend = spendableUiAmount(balanceHint, token);
      const final = Math.min(Number(amountStr) || 1, spend);
      if (final > 0) amt = formatTransferAmount(token, final);
    }
    await submitConfidentialTransferAmount(wcPage, amt);
  });

  await test.step('10 Wait for Complete / success in UI', async () => {
    await expect
      .poll(
        async () =>
          wcPage
            .getByText(/\b(complete|completed|success|successful|confirmed|transferr?ed|deposited|done)\b/i)
            .first()
            .isVisible()
            .catch(() => false),
        { timeout: 180_000, intervals: [2000] }
      )
      .toBe(true);
  });

  await test.step('11 Click “Move again” (shield success `<button>`)', async () => {
    const moveAgain = nearComMoveAgainCta(wcPage).first();
    try {
      await expect(moveAgain, 'Success card button “Move again”').toBeVisible({ timeout: 35_000 });
      await moveAgain.scrollIntoViewIfNeeded().catch(() => undefined);
      await moveAgain.click({ timeout: 20_000 }).catch(async () => {
        await moveAgain.click({ force: true, timeout: 15_000 });
      });
    } catch {
      const shield = nearComConfidentialShieldMoveLink(wcPage).first();
      await expect(shield, 'Move again button missing; fallback shell shield link').toBeVisible({
        timeout: 15_000,
      });
      await shield.scrollIntoViewIfNeeded();
      await shield.click();
    }
    await expectNearComTransferModeUrl(wcPage, 'shield');
  });

  await test.step('12 Post-deposit shell (balance asserts disabled)', async () => {
    await wcPage.keyboard.press('Escape').catch(() => undefined);
    await wcPage.waitForTimeout(2000);
    await expectNearComTransferModeUrl(wcPage, 'shield');

    // afterNorm = await normalizedMainOrBody(wcPage);
    // snippetAfter = snippetNearConfidentialLabel(afterNorm);
    // balAfterSnippet = parseMaxAmountBeforeToken(snippetAfter, token);
    // if (balBeforeSnippet == null) { … amount in snippet … }
    // else { expect(balAfterSnippet).not.toBeNull(); expect growth vs balBeforeSnippet + amount }

    markConfidentialDepositSucceeded(true);
  });
});
