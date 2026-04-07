/**
 * contracts-pricing.regression.spec.ts
 *
 * Sequential orchestration: one login → salesrep users → director users → executive users.
 * Emits "STARTING ROLE: <role>" markers so the QA dashboard can update the active button.
 *
 * ROLE env var (optional):
 *   unset | 'all'  → run all three roles in order  (default)
 *   'salesrep'     → run only Sales Rep users
 *   'director'     → run only Director users
 *   'executive'    → run only Executive users
 */

import { test } from '@playwright/test';
import { ImpersonationPage } from '../../pages/ImpersonationPage';
import { SALES_REPS, DIRECTORS, EXECUTIVES } from '../../data/users';
import { loginAsAdmin }     from '../../helpers/auth.helper';
import { initRun, logStep } from '../../helpers/step.helper';

const ROLE_USERS_LIST = {
  salesrep:  SALES_REPS,
  director:  DIRECTORS,
  executive: EXECUTIVES,
} as const;

type Role = keyof typeof ROLE_USERS_LIST;

const ROLES_TO_RUN: Role[] = (() => {
  const r = process.env.ROLE as string | undefined;
  if (r && r !== 'all' && Object.prototype.hasOwnProperty.call(ROLE_USERS_LIST, r)) {
    return [r as Role];
  }
  return ['salesrep', 'director', 'executive'] as Role[];
})();

function makeSection(page: import('@playwright/test').Page) {
  return async function S(label: string, fn: () => Promise<void>) {
    await logStep(page, `━━ ${label} ━━`, 'info');
    try { await fn(); }
    catch (e: unknown) {
      const msg   = String((e as Error)?.message ?? e).split('\n')[0];
      const atUrl = page.url();
      await logStep(page, `FAIL "${label}": ${msg} | URL: ${atUrl}`, 'fail');
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(400);
    }
  };
}

test(`Contracts & Pricing — ${ROLES_TO_RUN.join('+') || 'all roles'}`, async ({ page }) => {
  initRun();

  const S             = makeSection(page);
  const impersonation = new ImpersonationPage(page);

  try {

    await S('Step 1 — Login as admin', async () => {
      await logStep(page, `Navigating to admin sign-in… (baseURL: ${page.url() || 'none yet'})`, 'running');
      await loginAsAdmin(page);
      await logStep(page, `Admin login ✓ — landed on: ${page.url()}`, 'pass');
    });

    for (const role of ROLES_TO_RUN) {
      const roleUsers = ROLE_USERS_LIST[role];
      await logStep(page, `════ STARTING ROLE: ${role} — ${roleUsers.length} users ════`, 'info');

      for (const user of roleUsers) {
        await logStep(page, `════ Testing user: ${user.fullName} (${user.company}) ════`, 'info');

        let isImpersonated = false;

        try {

          await S(`Step 2 — Impersonate ${user.fullName} (${role} @ ${user.company})`, async () => {
            await logStep(page, `Impersonating ${user.fullName}…`, 'running');
            await impersonation.impersonateUser(user);
            isImpersonated = true;
            await logStep(page, 'Impersonation confirmed ✓', 'pass');
          });

          await S('Step 3 — Contracts & Pricing page loads', async () => {
            await logStep(page, 'Navigating to Contracts & Pricing page…', 'running');
            await page.getByRole('button', { name: /contracts/i })
              .or(page.getByRole('link', { name: /contracts/i }))
              .first()
              .click({ timeout: 10_000 });
            await page.waitForLoadState('networkidle').catch(() => {});
            await page.waitForTimeout(1_500);
            await logStep(page, 'Contracts & Pricing page loaded ✓', 'pass');

            const heading = page.getByRole('heading', { name: /contracts/i })
              .or(page.locator('h1,h2').filter({ hasText: /contracts/i }));
            const headingVisible = await heading.first().isVisible({ timeout: 15_000 }).catch(() => false);
            await logStep(
              page,
              `Contracts & Pricing heading visible: ${headingVisible ? '✓' : 'FAIL'}`,
              headingVisible ? 'pass' : 'fail'
            );
          });

          // TODO: Add full Contracts & Pricing spec steps here

        } finally {
          if (isImpersonated) {
            try {
              await logStep(page, `Exiting impersonation for ${user.fullName}…`, 'running');
              await impersonation.exitImpersonation();
              await logStep(page, `Impersonation for ${user.fullName} exited ✓`, 'pass');
            } catch {}
          }
        }

      } // end for user
    } // end for role

  } finally {}
});
