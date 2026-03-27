/**
 * accounts.regression.spec.ts
 * Regression suite for the Accounts page — all 9 users.
 * TODO: Full spec pending from product owner.
 * Current coverage: page load + basic visibility for every user.
 */

import { test, expect } from '@playwright/test';
import { ImpersonationPage } from '../../pages/ImpersonationPage';
import { IMPERSONATION_MATRIX } from '../../data/users';
import { loginAsAdmin }      from '../../helpers/auth.helper';
import { initRun, logStep }  from '../../helpers/step.helper';

test.beforeAll(() => { initRun(); });

test.beforeEach(async ({ page }) => {
  await logStep(null, 'Logging in as admin…', 'running');
  await loginAsAdmin(page);
  await logStep(page, 'Admin login successful', 'pass');
});

test.describe('Accounts — Page Load (all 9 users)', () => {
  for (const user of IMPERSONATION_MATRIX) {
    test(`[ACCOUNTS-R1] Page loads — ${user.fullName} · ${user.role}`, async ({ page }) => {
      const impersonation = new ImpersonationPage(page);

      await logStep(page, `Impersonating ${user.fullName} (${user.role})…`, 'running');
      await impersonation.impersonateUser(user);
      await logStep(page, 'Impersonation confirmed ✓', 'pass');

      await logStep(page, 'Navigating to Accounts page…', 'running');
      await page.getByRole('button', { name: 'Accounts' }).click();
      await page.waitForLoadState('networkidle');
      await logStep(page, 'Accounts page loaded', 'pass');

      // TODO: Replace with real heading selector once confirmed
      const heading = page.getByRole('heading', { name: /accounts/i })
        .or(page.locator('h1,h2').filter({ hasText: /accounts/i }));
      await expect(heading).toBeVisible({ timeout: 15_000 });
      await logStep(page, 'Accounts heading visible ✓', 'pass');

      // TODO: Add full Accounts page spec here:
      // - Table/list of accounts renders
      // - Search works
      // - Filters work
      // - Detail navigation works
      // - Role-based visibility

      await logStep(page, `Exiting impersonation for ${user.fullName}…`, 'running');
      await impersonation.exitImpersonation();
      await logStep(page, 'Done ✓', 'pass');
    });
  }
});
