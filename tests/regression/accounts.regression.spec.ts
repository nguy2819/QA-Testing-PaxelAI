/**
 * accounts.regression.spec.ts
 */

import { test, type Page, type Locator } from '@playwright/test';
import { ImpersonationPage } from '../../pages/ImpersonationPage';
import { SALES_REPS, DIRECTORS, EXECUTIVES } from '../../data/users';
import { loginAsAdmin } from '../../helpers/auth.helper';
import { initRun, logStep } from '../../helpers/step.helper';

const ROLE_USERS_LIST = {
  salesrep: SALES_REPS,
  director: DIRECTORS,
  executive: EXECUTIVES,
} as const;

type Role = keyof typeof ROLE_USERS_LIST;

const ROLES_TO_RUN: Role[] = (() => {
  const r = process.env.ROLE as string | undefined;
  if (r && r !== 'all' && Object.prototype.hasOwnProperty.call(ROLE_USERS_LIST, r)) {
    return [r as Role];
  }
  return ['salesrep', 'director', 'executive'];
})();

function makeSection(page: Page) {
  return async function S(label: string, fn: () => Promise<void>) {
    await logStep(page, `━━ ${label} ━━`, 'info');
    try {
      await fn();
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? e).split('\n')[0];
      await logStep(page, `FAIL "${label}": ${msg} | URL: ${page.url()}`, 'fail');
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — Sales Summary style, resilient for custom table/dropdown UI
// ─────────────────────────────────────────────────────────────────────────────

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getAccountsSearchInput(page: Page): Locator {
  return page
    .getByPlaceholder(/search.*(name|city|id|dea|hin|340b|dsh)/i)
    .or(page.locator('input[type="search"]'))
    .or(page.locator('input').filter({ hasText: /search/i }))
    .first();
}

function getAccountsRegion(page: Page): Locator {
  return page.locator('body').first();
}

function getAccountsTable(page: Page): Locator {
  return page
    .locator('table, [role="table"], [role="grid"]')
    .or(page.locator('[data-testid*="account" i]'))
    .or(page.locator('div').filter({ hasText: /Name/i }).filter({ hasText: /Location/i }).filter({ hasText: /Owner/i }))
    .first();
}

function getAccountsRows(page: Page): Locator {
  return page
    .locator('tbody tr')
    .or(page.locator('[role="row"]').filter({ hasNotText: /Name\s+Location/i }))
    .or(page.locator('a[href*="/account"]').locator('xpath=ancestor::*[self::tr or self::div][1]'));
}

async function getFirstAccountName(page: Page): Promise<string> {
  const accountLink = page.locator('a[href*="/account"]').first();
  const linkText = normalizeText((await accountLink.textContent().catch(() => '')) ?? '');
  if (linkText) return linkText;

  const firstCell = page
    .locator('tbody tr:first-child td:first-child, [role="row"] [role="cell"]')
    .first();

  return normalizeText((await firstCell.textContent().catch(() => '')) ?? '');
}

function getFilterDropdownByLabel(page: Page, labelText: string): Locator {
  const filterBar = page.locator('nav').filter({
    has: page.getByText('Account type'),
  }).first();

  return filterBar
    .locator('div')
    .filter({ hasText: new RegExp(`^${labelText}$`, 'i') })
    .locator('xpath=ancestor::div[contains(@class, "relative")][1]')
    .locator('[role="button"]')
    .first();
}

async function getOpenDropdownPanel(page: Page): Promise<Locator> {
  await page.waitForTimeout(300);

  const panel = page
    .locator([
      '[role="listbox"]',
      '[role="menu"]',
      '[role="dialog"]',
      '[data-radix-popper-content-wrapper]',
      '[data-floating-ui-portal]',
      '[class*="popover" i]',
      '[class*="dropdown" i]',
      '[class*="select" i]',
      'div[style*="position: fixed"]',
      'div[style*="position: absolute"]',
    ].join(', '))
    .filter({ hasText: /All/i })
    .last();

  return panel;
}

async function waitForAccountsTableSettled(page: Page): Promise<void> {
  await page
    .waitForResponse(
      r =>
        r.status() === 200 &&
        /\/tenant\/.*(account|accounts|customers|summary|table)/i.test(r.url()),
      { timeout: 8000 }
    )
    .catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(700);
}

async function scrollDropdownToBottom(panel: Locator): Promise<void> {
  await panel.evaluate(el => {
    el.scrollTop = el.scrollHeight;
  }).catch(() => {});
  await panel.locator('..').evaluate(el => {
    el.scrollTop = el.scrollHeight;
  }).catch(() => {});
}

async function chooseRandomNonAllOption(panel: Locator): Promise<string | null> {
  const options = panel
    .locator('[role="option"], button, li, div')
    .filter({ hasNotText: /^$/ });

  const count = await options.count().catch(() => 0);
  const valid: { loc: Locator; text: string }[] = [];

  for (let i = 0; i < count; i++) {
    const loc = options.nth(i);
    const text = normalizeText((await loc.textContent().catch(() => '')) ?? '');

    if (
      text &&
      !/^all$/i.test(text) &&
      !/search/i.test(text) &&
      text.length < 80 &&
      (await loc.isVisible().catch(() => false))
    ) {
      valid.push({ loc, text });
    }
  }

  if (!valid.length) return null;

  const picked = valid[Math.floor(Math.random() * valid.length)];
  await picked.loc.click({ timeout: 5000 });
  return picked.text;
}

async function resetDropdownToAll(page: Page, labelRegex: RegExp, labelName: string): Promise<void> {
  const dropdownLabel =
    labelName === 'IDN / Health System' ? 'IDN' : labelName;

  const trigger = getFilterDropdownByLabel(page, dropdownLabel);

  const triggerVisible = await trigger.isVisible({ timeout: 8000 }).catch(() => false);
  await logStep(page, `  ${labelName} trigger visible: ${triggerVisible ? '✓' : 'FAIL'}`, triggerVisible ? 'pass' : 'fail');
  await logStep(page, `  Cannot find ${labelName} dropdown trigger — need inspect locator`, 'fail');
  await logStep(page, `  ${labelName} dropdown panel opened: ${panelVisible ? '✓' : 'FAIL'}`, panelVisible ? 'pass' : 'fail');

  if (!triggerVisible) {
    await logStep(page, '  Cannot find Account type dropdown trigger — need inspect locator', 'fail');
    return;
  }

  await trigger.scrollIntoViewIfNeeded().catch(() => {});
  await trigger.click({ timeout: 8000, force: true });

  const panel = await getOpenDropdownPanel(page);
  const panelVisible = await panel.isVisible({ timeout: 6000 }).catch(() => false);

  await logStep(page, `  Account type dropdown panel opened: ${panelVisible ? '✓' : 'FAIL'}`, panelVisible ? 'pass' : 'fail');
}

async function validateAccountsTableOrEmptyState(page: Page, stepId: string): Promise<void> {
  const rows = getAccountsRows(page);
  const rowCount = await rows.count().catch(() => 0);

  if (rowCount > 0) {
    await logStep(page, `  [${stepId}] Accounts rows visible: ${rowCount} ✓`, 'pass');
    return;
  }

  const empty = page
    .getByText(/no accounts|no results|no data|nothing found|empty/i)
    .or(page.locator('[data-testid*="empty" i], [class*="empty" i], [class*="no-result" i]'))
    .first();

  if (await empty.isVisible({ timeout: 3000 }).catch(() => false)) {
    await logStep(page, `  [${stepId}] Valid empty state visible ✓`, 'pass');
  } else {
    await logStep(page, `  [${stepId}] No rows and no clear empty state — FAIL`, 'fail');
  }
}

async function verifyHeader(page: Page, label: string, regex: RegExp) {
  const header = page
    .locator('th, [role="columnheader"], div, span')
    .filter({ hasText: regex })
    .first();

  const visible = await header.isVisible({ timeout: 4000 }).catch(() => false);
  await logStep(page, `  Header "${label}" visible: ${visible ? '✓' : 'FAIL'}`, visible ? 'pass' : 'fail');
}

async function testDropdown(
  page: Page,
  labelRegex: RegExp,
  labelName: string,
  stepId: string,
  innerSearchRegex?: RegExp
) {
  const dropdownLabel =
    labelName === 'IDN / Health System' ? 'IDN' : labelName;

  const trigger = getFilterDropdownByLabel(page, dropdownLabel);
  const triggerVisible = await trigger.isVisible({ timeout: 8000 }).catch(() => false);
  await logStep(page, `  ${labelName} dropdown visible: ${triggerVisible ? '✓' : 'FAIL'}`, triggerVisible ? 'pass' : 'fail');
  if (!triggerVisible) return;

  await trigger.click({ timeout: 8000 });
  await logStep(page, `  Clicked ${labelName} dropdown`, 'info');

  const panel = await getOpenDropdownPanel(page);
  const panelVisible = await panel.isVisible({ timeout: 6000 }).catch(() => false);
  await logStep(page, `  ${labelName} dropdown opened: ${panelVisible ? '✓' : 'FAIL'}`, panelVisible ? 'pass' : 'fail');
  if (!panelVisible) return;

  if (innerSearchRegex) {
    const innerSearch = panel.getByPlaceholder(innerSearchRegex).or(panel.locator('input')).first();
    const innerSearchVisible = await innerSearch.isVisible({ timeout: 3000 }).catch(() => false);
    await logStep(page, `  ${labelName} inner search visible: ${innerSearchVisible ? '✓' : 'FAIL'}`, innerSearchVisible ? 'pass' : 'fail');
  }

  const all = panel.locator('[role="option"], button, li, div').filter({ hasText: /^All$/i }).first();
  const allVisible = await all.isVisible({ timeout: 4000 }).catch(() => false);
  await logStep(page, `  All option visible: ${allVisible ? '✓' : 'FAIL'}`, allVisible ? 'pass' : 'fail');

  await scrollDropdownToBottom(panel);

  const chosenText = await chooseRandomNonAllOption(panel);
  if (!chosenText) {
    await logStep(page, `  No non-All ${labelName} option found — skip selection`, 'info');
    await page.keyboard.press('Escape').catch(() => {});
    return;
  }

  await logStep(page, `  Selected ${labelName}: "${chosenText}"`, 'pass');
  await waitForAccountsTableSettled(page);

  const newTriggerText = normalizeText((await trigger.textContent().catch(() => '')) ?? '');
  const reflected = newTriggerText.toLowerCase().includes(chosenText.toLowerCase());

  await logStep(
    page,
    `  Selected value reflected in ${labelName} trigger: ${reflected ? '✓' : 'INFO'} — trigger text: "${newTriggerText}"`,
    reflected ? 'pass' : 'info'
  );

  await validateAccountsTableOrEmptyState(page, `${stepId}-filter`);
  await resetDropdownToAll(page, labelRegex, labelName);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────────────────────────────────────

test(`Accounts — ${ROLES_TO_RUN.join('+') || 'all roles'}`, async ({ page }) => {
  initRun();

  const S = makeSection(page);
  const impersonation = new ImpersonationPage(page);

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

        await S('Step 3 — Accounts page loads', async () => {
          await logStep(page, 'Navigating to Accounts page…', 'running');

          await page
            .getByRole('button', { name: /accounts/i })
            .or(page.getByRole('link', { name: /accounts/i }))
            .first()
            .click({ timeout: 10000 });

          await waitForAccountsTableSettled(page);

          const heading = page
            .getByRole('heading', { name: /accounts/i })
            .or(page.locator('h1,h2').filter({ hasText: /accounts/i }))
            .first();

          const headingVisible = await heading.isVisible({ timeout: 15000 }).catch(() => false);
          await logStep(page, `Accounts heading visible: ${headingVisible ? '✓' : 'FAIL'}`, headingVisible ? 'pass' : 'fail');
        });

        await S('Step 4 — Accounts filters visible', async () => {
          const searchInput = getAccountsSearchInput(page);
          const searchVisible = await searchInput.isVisible({ timeout: 8000 }).catch(() => false);
          await logStep(page, `  Search box visible: ${searchVisible ? '✓' : 'FAIL'}`, searchVisible ? 'pass' : 'fail');

          for (const [name, regex] of [
            ['Account type', /account\s*type/i],
            ['IDN / Health System', /IDN|Health System/i],
            ['Owner', /owner/i],
          ] as const) {
            const dropdownLabel =
              name === 'IDN / Health System' ? 'IDN' : name;

            const dd = getFilterDropdownByLabel(page, dropdownLabel);
            const visible = await dd.isVisible({ timeout: 6000 }).catch(() => false);
            await logStep(page, `  ${name} dropdown visible: ${visible ? '✓' : 'FAIL'}`, visible ? 'pass' : 'fail');
          }

          await validateAccountsTableOrEmptyState(page, 'Step4');

          await verifyHeader(page, 'Name', /^Name$/i);
          await verifyHeader(page, 'Location', /Location/i);
          await verifyHeader(page, 'Account type', /Account\s*type/i);
          await verifyHeader(page, 'IDN / Health System', /IDN|Health System/i);
          await verifyHeader(page, 'Owner', /^Owner$/i);
        });

        await S('Step 5 — Search box', async () => {
          const searchInput = getAccountsSearchInput(page);

          const visible = await searchInput.isVisible({ timeout: 6000 }).catch(() => false);
          await logStep(page, `  Search input visible: ${visible ? '✓' : 'FAIL'}`, visible ? 'pass' : 'fail');

          const enabled = await searchInput.isEnabled({ timeout: 4000 }).catch(() => false);
          await logStep(page, `  Search input enabled: ${enabled ? '✓' : 'FAIL'}`, enabled ? 'pass' : 'fail');

          const rawName = await getFirstAccountName(page);
          if (!rawName) {
            await logStep(page, '  Could not read first account name — skip search test', 'info');
            return;
          }

          const searchTerm = rawName.slice(0, Math.min(8, rawName.length));
          await logStep(page, `  Searching account using: "${searchTerm}"`, 'info');

          await searchInput.fill(searchTerm);
          await waitForAccountsTableSettled(page);

          const match = getAccountsRegion(page).filter({ hasText: new RegExp(escRe(searchTerm), 'i') });
          const matchVisible = await match.first().isVisible({ timeout: 6000 }).catch(() => false);

          await logStep(
            page,
            `  Matching account appears after search: ${matchVisible ? '✓' : 'FAIL'}`,
            matchVisible ? 'pass' : 'fail'
          );

          await searchInput.clear();
          await waitForAccountsTableSettled(page);
          await validateAccountsTableOrEmptyState(page, 'Step5-clear');
        });

        await S('Step 6 — Account type dropdown', async () => {
          await testDropdown(page, /account\s*type/i, 'Account type', 'Step6');
        });

        await S('Step 7 — IDN / Health System dropdown', async () => {
          await testDropdown(
            page,
            /IDN|Health System/i,
            'IDN / Health System',
            'Step7',
            /search\s*(idns?|health\s*systems?)/i
          );
        });

        await S('Step 8 — Owner dropdown', async () => {
          await testDropdown(page, /owner/i, 'Owner', 'Step8');
        });
      } finally {
        if (isImpersonated) {
          try {
            await logStep(page, `Exiting impersonation for ${user.fullName}…`, 'running');
            await impersonation.exitImpersonation();
            await logStep(page, `Impersonation for ${user.fullName} exited ✓`, 'pass');
          } catch {}
        }
      }
    }
  }
});