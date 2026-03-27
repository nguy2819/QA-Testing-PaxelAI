/**
 * opportunities.regression.spec.ts
 * Regression suite for the Opportunities page — all 9 users.
 * TODO: Full spec pending from product owner.
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

test.describe('Opportunities — Page Load (all 9 users)', () => {
  for (const user of IMPERSONATION_MATRIX) {
    test(`[OPP-R1] Page loads — ${user.fullName} · ${user.role}`, async ({ page }) => {
      const impersonation = new ImpersonationPage(page);

      await logStep(page, `Impersonating ${user.fullName} (${user.role})…`, 'running');
      await impersonation.impersonateUser(user);
      await logStep(page, 'Impersonation confirmed ✓', 'pass');

      await logStep(page, 'Navigating to Opportunities page…', 'running');
      await page.getByRole('button', { name: 'Opportunities' }).click();
      await page.waitForLoadState('networkidle');
      await logStep(page, 'Opportunities page loaded', 'pass');

      const heading = page.getByRole('heading', { name: /opportunities/i })
        .or(page.locator('h1,h2').filter({ hasText: /opportunities/i }));
      await expect(heading).toBeVisible({ timeout: 15_000 });
      await logStep(page, 'Opportunities heading visible ✓', 'pass');

      // TODO: Add full Opportunities page spec here

      await logStep(page, `Exiting impersonation for ${user.fullName}…`, 'running');
      await impersonation.exitImpersonation();
      await logStep(page, 'Done ✓', 'pass');
    });
  }
});
