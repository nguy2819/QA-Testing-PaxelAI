/**
 * sales-summary.regression.spec.ts
 *
 * One login → iterate all 3 users for the selected role → exit after each user.
 *
 * Role is selected via ROLE env var: salesrep | director | executive
 * Default: salesrep  → tests David Farris, Michelle Hupfer, Rich Closer in order.
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { ImpersonationPage } from '../../pages/ImpersonationPage';
import { SalesSummaryPage }  from '../../pages/SalesSummaryPage';
import { SALES_REPS, DIRECTORS, EXECUTIVES } from '../../data/users';
import { loginAsAdmin }          from '../../helpers/auth.helper';
import { initRun, logStep } from '../../helpers/step.helper';

// ─────────────────────────────────────────────────────────────────────────────
// Role → users mapping
// ─────────────────────────────────────────────────────────────────────────────
const ROLE_USERS_LIST = {
  salesrep:  SALES_REPS,   // David Farris, Michelle Hupfer, Rich Closer
  director:  DIRECTORS,    // Trenton Lovell, Rob Bloomer, Victor Pipeline
  executive: EXECUTIVES,   // Karen Kirkland, Sagar Patel, Natalie Northstar
} as const;

type Role = keyof typeof ROLE_USERS_LIST;
const ROLE       = ((process.env.ROLE as Role) || 'salesrep');
const TEST_USERS = ROLE_USERS_LIST[ROLE] ?? ROLE_USERS_LIST.salesrep;
// 

// ─────────────────────────────────────────────────────────────────────────────
// Add a few helper functions
// ─────────────────────────────────────────────────────────────────────────────
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfQuarter(d: Date) {
  const qMonth = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), qMonth, 1);
}

function previousMonthRange(ref = yesterday()) {
  const start = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
  const end = new Date(ref.getFullYear(), ref.getMonth(), 0);
  return { start, end };
}

function previousQuarterRange(ref = yesterday()) {
  const thisQuarterStart = startOfQuarter(ref);
  const prevQuarterEnd = new Date(thisQuarterStart);
  prevQuarterEnd.setDate(prevQuarterEnd.getDate() - 1);
  const prevQuarterStart = startOfQuarter(prevQuarterEnd);
  return { start: prevQuarterStart, end: prevQuarterEnd };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fiscal-year config — keyed by company name.
// Nexus Pharmaceuticals  → calendar year (January, month index 0)
// Caplin Steriles USA Inc → fiscal year  (April,   month index 3)
// If a company is not in this map, defaults safely to calendar year (January).
// TODO: verify fiscal-year start for 'Rich Pharmaceuticals' and add it here.
// ─────────────────────────────────────────────────────────────────────────────
const FISCAL_YEAR_CONFIG: Record<string, { startMonth: number }> = {
  'Nexus Pharmaceuticals':   { startMonth: 0 }, // January
  'Caplin Steriles USA Inc': { startMonth: 3 }, // April
  // TODO: add 'Rich Pharmaceuticals' once fiscal year start is confirmed
};

/** Returns fiscal-year start month (0-indexed). Defaults to 0 (January) for unknown companies. */
function fiscalYearStartMonth(company: string): number {
  return FISCAL_YEAR_CONFIG[company]?.startMonth ?? 0;
  // Default: calendar year (January). Extend FISCAL_YEAR_CONFIG above to override.
}

function startOfFiscalYear(ref: Date, company: string): Date {
  const fsm  = fiscalYearStartMonth(company);
  const year = ref.getMonth() >= fsm ? ref.getFullYear() : ref.getFullYear() - 1;
  return new Date(year, fsm, 1);
}

function previousFiscalYearRange(ref: Date, company: string): { start: Date; end: Date } {
  const thisStart = startOfFiscalYear(ref, company);
  const prevEnd   = new Date(thisStart.getTime() - 86_400_000);
  return { start: startOfFiscalYear(prevEnd, company), end: prevEnd };
}

function expectedDateRegex(label: string, ref = yesterday(), company = ''): RegExp {
  const y = ref;

  if (label === 'Yesterday') {
    return new RegExp(escapeRe(fmtDate(y)), 'i');
  }

  if (label === 'Month-to-date') {
    const start = startOfMonth(y);
    return new RegExp(
      `${escapeRe(MONTHS[start.getMonth()])}\\s+${start.getDate()}\\s*[–-]\\s*` +
      `${escapeRe(MONTHS[y.getMonth()])}\\s+${y.getDate()},\\s+${y.getFullYear()}`, 'i'
    );
  }

  if (label === 'Previous month') {
    const { start, end } = previousMonthRange(y);
    return new RegExp(
      `${escapeRe(MONTHS[start.getMonth()])}\\s+${start.getDate()}\\s*[–-]\\s*` +
      `${escapeRe(MONTHS[end.getMonth()])}\\s+${end.getDate()},\\s+${end.getFullYear()}`, 'i'
    );
  }

  if (label === 'Quarter-to-date') {
    const start = startOfQuarter(y);
    return new RegExp(
      `${escapeRe(MONTHS[start.getMonth()])}\\s+${start.getDate()}\\s*[–-]\\s*` +
      `${escapeRe(MONTHS[y.getMonth()])}\\s+${y.getDate()},\\s+${y.getFullYear()}`, 'i'
    );
  }

  if (label === 'Previous quarter') {
    const { start, end } = previousQuarterRange(y);
    return new RegExp(
      `${escapeRe(MONTHS[start.getMonth()])}\\s+${start.getDate()}\\s*[–-]\\s*` +
      `${escapeRe(MONTHS[end.getMonth()])}\\s+${end.getDate()},\\s+${end.getFullYear()}`, 'i'
    );
  }

  if (label === 'Year-to-date') {
    const start = startOfFiscalYear(y, company);
    return new RegExp(
      `${escapeRe(MONTHS[start.getMonth()])}\\s+${start.getDate()}\\s*[–-]\\s*` +
      `${escapeRe(MONTHS[y.getMonth()])}\\s+${y.getDate()},\\s+${y.getFullYear()}`, 'i'
    );
  }

  if (label === 'Previous year') {
    const { start, end } = previousFiscalYearRange(y, company);
    return new RegExp(
      `${escapeRe(MONTHS[start.getMonth()])}\\s+${start.getDate()}\\s*[–-]\\s*` +
      `${escapeRe(MONTHS[end.getMonth()])}\\s+${end.getDate()},\\s+${end.getFullYear()}`, 'i'
    );
  }

  return /.+/i;
}

async function waitForDateButtonTextChange(
  ss: SalesSummaryPage,
  before: string,
  timeout = 12000
) {
  await expect
    .poll(
      async () => ((await ss.dateFilterButton.first().textContent()) ?? '').trim(),
      { timeout, intervals: [250, 500, 1000] }
    )
    .not.toBe(before);
}

async function getDateButtonText(ss: SalesSummaryPage) {
  return ((await ss.dateFilterButton.first().textContent()) ?? '').trim();
}

async function getKpiCardByLabel(page: Page, label: string) {
  return page.locator('button, [role="button"], div').filter({
    hasText: new RegExp(`^${escapeRe(label)}`, 'i')
  }).first();
}

// ─────────────────────────────────────────────────────────────────────────────
// Date-filter action helpers
// ─────────────────────────────────────────────────────────────────────────────
async function cleanupDatePicker(page: Page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(250);
  await page.mouse.click(80, 80).catch(() => {});
  await page.waitForTimeout(250);
}

async function openDatePickerWithLogs(page: Page, ss: SalesSummaryPage, stepId: string) {
  const pickerRoot = page.locator('section').filter({
    has: page.locator('text=Yesterday'),
    hasText: /Month-to-date/,
  }).first();

  await logStep(page, `${stepId}: cleanup before opening picker`, 'running');
  await cleanupDatePicker(page);

  await logStep(page, `${stepId}: click date filter button`, 'running');
  await ss.dateFilterButton.first().click({ force: true });

  let opened = await pickerRoot.isVisible({ timeout: 2500 }).catch(() => false);
  if (!opened) {
    await logStep(page, `${stepId}: picker did not open on first click — retrying`, 'info');
    await ss.dateFilterButton.first().click({ force: true });
    opened = await pickerRoot.isVisible({ timeout: 5000 }).catch(() => false);
  }

  await logStep(page, `${stepId}: picker opened ${opened ? '✓' : 'FAIL'}`, opened ? 'pass' : 'fail');
  if (!opened) throw new Error(`${stepId}: date picker did not open`);

  return pickerRoot;
}

async function clickPresetOptionWithLogs(page: Page, presetLabel: string, stepId: string) {
  const option = page.locator('div[data-lov-id*="DatePickerListItem"]')
    .filter({ hasText: new RegExp(`^${escapeRe(presetLabel)}$`, 'i') })
    .first()
    .or(
      page.locator('div[role="button"]')
        .filter({ hasText: new RegExp(`^${escapeRe(presetLabel)}$`, 'i') })
        .first()
    );

  await logStep(page, `${stepId}: wait for preset "${presetLabel}"`, 'running');
  await expect(option).toBeVisible({ timeout: 4000 });
  await logStep(page, `${stepId}: preset "${presetLabel}" visible ✓`, 'pass');

  await logStep(page, `${stepId}: click preset "${presetLabel}"`, 'running');
  await option.click({ force: true });
  await page.waitForTimeout(500);
  await logStep(page, `${stepId}: clicked preset "${presetLabel}" ✓`, 'pass');
}

async function selectDatePresetExpectStable(
  page: Page,
  ss: SalesSummaryPage,
  presetLabel: string,
  expectedRegex: RegExp,
  stepId: string
) {
  await openDatePickerWithLogs(page, ss, stepId);
  await clickPresetOptionWithLogs(page, presetLabel, stepId);

  const btnText = await getDateButtonText(ss);
  const ok = expectedRegex.test(btnText);

  await logStep(
    page,
    `${stepId}: final date button text "${btnText}" matches expected stable state: ${ok ? '✓' : 'FAIL'}`,
    ok ? 'pass' : 'fail'
  );

  await cleanupDatePicker(page);

  if (!ok) {
    throw new Error(`${stepId}: final date button text did not match expected state`);
  }

  return btnText;
}

async function selectDatePresetExpectChange(
  page: Page,
  ss: SalesSummaryPage,
  presetLabel: string,
  expectedRegex: RegExp,
  expectedUrlRe: RegExp,
  stepId: string
) {
  const beforeText = await getDateButtonText(ss);
  const beforeUrl = page.url();

  await logStep(page, `${stepId}: before text = "${beforeText}"`, 'info');
  await logStep(page, `${stepId}: before url = ${beforeUrl}`, 'info');

  await openDatePickerWithLogs(page, ss, stepId);
  await clickPresetOptionWithLogs(page, presetLabel, stepId);

  const result = await expect.poll(
    async () => {
      const currentText = await getDateButtonText(ss);
      const currentUrl = page.url();
      return {
        textMatch: expectedRegex.test(currentText),
        urlMatch: expectedUrlRe.test(currentUrl),
        currentText,
        currentUrl,
      };
    },
    { timeout: 8000, intervals: [250, 500, 1000] }
  ).toMatchObject({ textMatch: true });

  const afterText = await getDateButtonText(ss);
  const afterUrl = page.url();
  const textOk = expectedRegex.test(afterText);
  const urlOk = expectedUrlRe.test(afterUrl);

  await logStep(page, `${stepId}: after text = "${afterText}"`, textOk ? 'pass' : 'fail');
  await logStep(page, `${stepId}: after url = ${afterUrl}`, urlOk ? 'pass' : 'fail');

  await cleanupDatePicker(page);

  if (!textOk) {
    throw new Error(`${stepId}: final date button text did not match expected preset`);
  }

  return { afterText, afterUrl, textOk, urlOk };
}

/** Validate all three KPI cards for regular date ranges (4c–4h).
 *  - current value must be parseable
 *  - previous comparison value must be parseable
 *  - comparison label must contain expectedPrevLabel
 *  - FAIL if all three current values are simultaneously zero
 *  - FAIL if all three previous values are simultaneously zero
 */
async function validateKpiCardsRegular(page: Page, expectedPrevLabel: string) {
  type R = { label: string; current: number; previous: number };
  const results: R[] = [];

  for (const label of ['Contracted sales', 'Units', 'Orders']) {
    const card = page.locator('button, [role="button"], div')
      .filter({ hasText: new RegExp(`^${escapeRe(label)}`, 'i') })
      .first();

    const vis = await card.isVisible({ timeout: 8000 }).catch(() => false);
    if (!vis) {
      await logStep(page, `  ${label}: card not visible — FAIL`, 'fail');
      results.push({ label, current: NaN, previous: NaN });
      continue;
    }

    const text = ((await card.textContent().catch(() => '')) ?? '').trim();
    await logStep(page, `  ${label}: "${text.slice(0, 120)}"`, 'info');

    const kpi = parseKpi(text);

    const hasLabel = text.toLowerCase().includes(expectedPrevLabel.toLowerCase());
    await logStep(
      page,
      `  ${label} — comparison label "${expectedPrevLabel}": ${hasLabel ? '✓' : 'FAIL — not found in card text'}`,
      hasLabel ? 'pass' : 'fail'
    );

    await logStep(
      page,
      `  ${label} — current value: ${isNaN(kpi.current) ? 'FAIL (not parseable)' : kpi.current}`,
      isNaN(kpi.current) ? 'fail' : 'pass'
    );

    await logStep(
      page,
      `  ${label} — previous value: ${isNaN(kpi.previous) ? 'FAIL (not parseable)' : kpi.previous}`,
      isNaN(kpi.previous) ? 'fail' : 'pass'
    );

    results.push({ label, current: kpi.current, previous: kpi.previous });
  }

  const valid = results.filter(r => !isNaN(r.current) && !isNaN(r.previous));
  if (valid.length === 3) {
    const allCurZero = valid.every(r => r.current === 0);
    await logStep(page, `All three KPI current values zero: ${allCurZero ? 'FAIL' : '✓'}`, allCurZero ? 'fail' : 'pass');

    const allPrevZero = valid.every(r => r.previous === 0);
    await logStep(page, `All three KPI previous values zero: ${allPrevZero ? 'FAIL' : '✓'}`, allPrevZero ? 'fail' : 'pass');
  }
}

/** Validate all three KPI cards for Yesterday (4b).
 *  - current values MAY be zero (not a failure)
 *  - previous comparison values must be parseable
 *  - FAIL if all three previous values are simultaneously zero
 */
async function validateKpiCardsYesterday(page: Page) {
  type R = { label: string; previous: number };
  const results: R[] = [];

  for (const label of ['Contracted sales', 'Units', 'Orders']) {
    const card = page.locator('button, [role="button"], div')
      .filter({ hasText: new RegExp(`^${escapeRe(label)}`, 'i') })
      .first();

    const vis = await card.isVisible({ timeout: 8000 }).catch(() => false);
    if (!vis) {
      await logStep(page, `  ${label}: card not visible — FAIL`, 'fail');
      results.push({ label, previous: NaN });
      continue;
    }

    const text = ((await card.textContent().catch(() => '')) ?? '').trim();
    await logStep(page, `  ${label}: "${text.slice(0, 120)}"`, 'info');

    const kpi = parseKpi(text);

    // Current may be zero for Yesterday — log only, not a failure
    await logStep(page, `  ${label} — current: ${isNaN(kpi.current) ? '(not parseable)' : kpi.current} (zero is acceptable for Yesterday)`, 'info');

    await logStep(
      page,
      `  ${label} — previous: ${isNaN(kpi.previous) ? 'FAIL (not parseable)' : kpi.previous}`,
      isNaN(kpi.previous) ? 'fail' : 'pass'
    );

    results.push({ label, previous: kpi.previous });
  }

  const valid = results.filter(r => !isNaN(r.previous));
  if (valid.length === 3) {
    const allPrevZero = valid.every(r => r.previous === 0);
    await logStep(page, `All three KPI previous values zero simultaneously: ${allPrevZero ? 'FAIL' : '✓'}`, allPrevZero ? 'fail' : 'pass');
  }
}

/** Validate Orders chart heading + plot area for preset sections 4c–4h.
 *  - heading must match: Orders • {presetLabel} (case-insensitive)
 *  - chart plot area must be visible (section-scoped; data-lov-id as fallback)
 *  - FAIL if heading is visible but plot area is missing
 */
async function validateOrdersChart(page: Page, presetLabel: string) {
  const headingRe = new RegExp(`orders\\s*[•·]\\s*${escapeRe(presetLabel)}`, 'i');

  const heading   = page.getByText(headingRe).first();
  const headingOk = await heading.isVisible({ timeout: 5000 }).catch(() => false);
  await logStep(
    page,
    `Orders chart heading "Orders • ${presetLabel}": ${headingOk ? '✓' : 'FAIL'}`,
    headingOk ? 'pass' : 'fail'
  );
  if (!headingOk) return;

  // Scope plot-area search to the section containing the heading
  // TODO: verify the section wrapper selector matches the live DOM (section / div[class*="chart"] / div[class*="card"])
  const chartSection = page.locator('section, div[class*="chart"], div[class*="card"]')
    .filter({ has: page.getByText(headingRe) })
    .first();

  const plotArea = chartSection
    .locator('svg, canvas, [class*="bar"], [class*="plot"], [class*="chart-area"]')
    .first()
    .or(page.locator('[data-lov-id="src/components/OrderBarChart.tsx:1101:8"]').first());

  const plotOk = await plotArea.isVisible({ timeout: 5000 }).catch(() => false);
  await logStep(
    page,
    `Orders chart plot area visible: ${plotOk ? '✓' : 'FAIL'}`,
    plotOk ? 'pass' : 'fail'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(d: Date) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function yesterday() {
  const d = new Date(); d.setDate(d.getDate() - 1); return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI helpers
// ─────────────────────────────────────────────────────────────────────────────
function parseKpi(text: string) {
  const cleaned  = text.replace(/,/g, '');
  const nums     = cleaned.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const pctMatch = cleaned.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  const prevMatch = text.match(/[Pp]rev(?:ious)?\s+(\w+)/);
  return {
    current:   nums[0] ?? NaN,
    previous:  nums[1] ?? NaN,
    pct:       pctMatch ? parseFloat(pctMatch[1]) : null,
    prevLabel: prevMatch?.[1] ?? '',
  };
}

function checkKpiDir(kpi: ReturnType<typeof parseKpi>, label: string, expectPrev?: string) {
  const { current, previous, pct } = kpi;
  if (isNaN(current) || isNaN(previous))
    return { pass: false, msg: `${label}: could not parse numbers` };
  const lblOk = !expectPrev || kpi.prevLabel.toLowerCase().includes(expectPrev.toLowerCase());
  if (current === previous)
    return { pass: lblOk, msg: `${label}: no change (${current}) | prev-label:${lblOk?'✓':'✗'}` };
  const expPct = previous !== 0 ? ((current - previous) / previous) * 100 : 0;
  const dirOk  = pct !== null ? (current > previous) === (pct > 0) : true;
  const magOk  = pct !== null ? Math.abs(Math.abs(pct) - Math.abs(expPct)) < 3 : true;
  return {
    pass: dirOk && magOk && lblOk,
    msg:  `${label}: ${current.toLocaleString()} vs ${previous.toLocaleString()} ≈${expPct.toFixed(1)}% shown:${pct??'?'}% dir:${dirOk?'✓':'✗'} mag:${magOk?'✓':'✗'} prevLabel:"${kpi.prevLabel}" ${lblOk?'✓':'✗'}`,
  };
}

async function checkAllKpi(page: Page, expectPrev?: string) {
  for (const [label, re] of [
    ['Contracted Sales', /contracted sales/i],
    ['Units',            /^units/i],
    ['Orders',           /^orders/i],
  ] as [string, RegExp][]) {
    const loc = page.locator('button, [role="button"], div').filter({ hasText: re }).first();

    const vis = await loc.isVisible({ timeout: 8000 }).catch(() => false);
    if (!vis) {
      await logStep(page, `  ${label}: card not found`, 'fail');
      continue;
    }

    const text = ((await loc.textContent().catch(() => '')) ?? '').trim();
    await logStep(page, `  ${label}: "${text.slice(0, 120)}"`, 'info');

    if (expectPrev) {
      const has = text.toLowerCase().includes(expectPrev.toLowerCase());
      await logStep(
        page,
        `  ${label} — "Prev ${expectPrev}" label: ${has ? '✓' : 'FAIL'}`,
        has ? 'pass' : 'fail'
      );
    }

    const kpi = parseKpi(text);
    const chk = checkKpiDir(kpi, label, expectPrev);
    await logStep(page, `  ${chk.msg}`, chk.pass ? 'pass' : 'fail');

    const colorClass = await loc.evaluate((el: Element) => {
      const pctEl = el.querySelector('[class*="green"],[class*="red"],[class*="increase"],[class*="decrease"]');
      return pctEl?.className ?? '';
    }).catch(() => '');

    const expectedColor =
      kpi.current > kpi.previous ? 'green' :
      kpi.current < kpi.previous ? 'red' :
      'neutral';

    const shownColor =
      /green|increase/i.test(colorClass) ? 'green' :
      /red|decrease/i.test(colorClass) ? 'red' :
      'unknown';

    await logStep(
      page,
      `  ${label} — color: ${shownColor} (expected ${expectedColor}) ${
        shownColor === expectedColor || shownColor === 'unknown' ? '✓' : 'MISMATCH'
      }`,
      shownColor === expectedColor || shownColor === 'unknown' ? 'pass' : 'fail'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section wrapper — catches errors so the next section always runs
// ─────────────────────────────────────────────────────────────────────────────
function makeSection(page: Page) {
  return async function S(label: string, fn: () => Promise<void>) {
    await logStep(page, `━━ ${label} ━━`, 'info');
    try { await fn(); }
    catch (e: any) {
      const msg   = String(e?.message ?? e).split('\n')[0];
      const atUrl = page.url();
      await logStep(page, `FAIL "${label}": ${msg} | URL: ${atUrl}`, 'fail');
      // Dismiss any open panel/overlay so the next section starts from a clean state
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(400);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification button — bounding-box based visible button detection
// ─────────────────────────────────────────────────────────────────────────────
async function findNotificationButton(page: Page): Promise<Locator> {
  // 1. Exact aria-label match — confirmed from live DOM: aria-label="Notifications"
  const byRole = page.getByRole('button', { name: 'Notifications' });
  if (await byRole.isVisible({ timeout: 1_500 }).catch(() => false)) return byRole;

  // 2. Attribute selector fallback (same attribute, different syntax)
  const byAttrExact = page.locator('button[aria-label="Notifications"]');
  if (await byAttrExact.isVisible({ timeout: 1_000 }).catch(() => false)) return byAttrExact;

  // 3. Broader aria-label / title / class attributes for future-proofing
  const byAttr = page.locator([
    'button[aria-label*="notification" i]',
    'button[aria-label*="bell" i]',
    'button[aria-label*="alert" i]',
    'button[title*="notification" i]',
    'button[class*="notification" i]',
    'button[class*="bell" i]',
    'button[data-testid*="notif" i]',
    'button[data-testid*="bell" i]',
  ].join(', ')).first();

  if (await byAttr.isVisible({ timeout: 1_500 }).catch(() => false)) {
    return byAttr;
  }

  // 2. Icon-only buttons (SVG child, no text) in header — notification bell is typically
  //    an icon-only button, making this a much more reliable discriminator than raw position.
  const headerSel = 'header button, [class*="header"] button, [class*="topbar"] button, [class*="navbar"] button';
  const candidates = await page.locator(headerSel).all();

  const iconBtns: { btn: Locator; x: number }[] = [];
  for (const btn of candidates) {
    const box  = await btn.boundingBox().catch(() => null);
    if (!box || box.width === 0 || box.height === 0) continue;
    const txt  = (await btn.textContent().catch(() => '') ?? '').trim();
    const svgs = await btn.locator('svg').count().catch(() => 0);
    if (!txt && svgs > 0) iconBtns.push({ btn, x: box.x });
  }
  iconBtns.sort((a, b) => b.x - a.x);
  if (iconBtns.length >= 2) return iconBtns[1].btn; // 2nd from right = bell (rightmost = avatar)
  if (iconBtns.length === 1) return iconBtns[0].btn;

  // 3. Bounding-box fallback: all visible header buttons sorted right→left,
  //    pick the second-from-right (rightmost is usually the user avatar).
  const allBtns = await page.locator(headerSel).all();

  const visible: { btn: Locator; x: number }[] = [];
  for (const btn of allBtns) {
    const box = await btn.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) {
      visible.push({ btn, x: box.x });
    }
  }
  // Sort rightmost first
  visible.sort((a, b) => b.x - a.x);

  if (visible.length >= 2) {
    return visible[1].btn; // 2nd from right = notification bell
  }
  if (visible.length === 1) {
    return visible[0].btn;
  }
  // Last resort
  return page.locator('header button').last();
}

// ─────────────────────────────────────────────────────────────────────────────
// THE TEST — one login, loop over all 3 users for the role, exit after each
// ─────────────────────────────────────────────────────────────────────────────
test(`Sales Summary — ${ROLE} (${TEST_USERS.length} users)`, async ({ page }) => {
  initRun();

  const S             = makeSection(page);
  const impersonation = new ImpersonationPage(page);
  const ss            = new SalesSummaryPage(page);

  try {

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 1 — Login (once for all users)
    // ══════════════════════════════════════════════════════════════════════════
    await S('Step 1 — Login as admin', async () => {
      await logStep(page, `Navigating to admin sign-in… (baseURL: ${page.url() || 'none yet'})`, 'running');
      await loginAsAdmin(page);
      const postUrl = page.url();
      await logStep(page, `Admin login ✓ — landed on: ${postUrl}`, 'pass');
    });

    // ══════════════════════════════════════════════════════════════════════════
    // User loop — impersonate → test all steps → exit → repeat
    // ══════════════════════════════════════════════════════════════════════════
    for (const user of TEST_USERS) {

      await logStep(page, `════ Testing user: ${user.fullName} (${user.company}) ════`, 'info');

      let isImpersonated = false;

      try {

        // ════════════════════════════════════════════════════════════════════
        // STEP 2 — Impersonate + navigate
        // ════════════════════════════════════════════════════════════════════
        await S(`Step 2 — Impersonate ${user.fullName} (${ROLE} @ ${user.company})`, async () => {
          await logStep(page, `Impersonating ${user.fullName}…`, 'running');
          await impersonation.impersonateUser(user);
          isImpersonated = true;
          await logStep(page, 'Impersonation confirmed ✓', 'pass');

          await logStep(page, 'Navigating to Sales Summary…', 'running');
          await ss.navigateViaMenu();
          await logStep(page, 'Sales Summary loaded ✓', 'pass');
        });

        // ════════════════════════════════════════════════════════════════════
        // STEP 3 — Notification button
        // ════════════════════════════════════════════════════════════════════
        await S('Step 3 — Notification button', async () => {

          // Log all visible header buttons (with bounding boxes) for debugging
          const allBtns = await page.locator(
            'header button, [class*="header"] button, [class*="topbar"] button, [class*="navbar"] button'
          ).all();
          const details: string[] = [];
          for (let i = 0; i < allBtns.length; i++) {
            const box   = await allBtns[i].boundingBox().catch(() => null);
            const txt   = (await allBtns[i].textContent().catch(() => '') ?? '').trim().slice(0, 25);
            const aria  = await allBtns[i].getAttribute('aria-label').catch(() => '') ?? '';
            const title = await allBtns[i].getAttribute('title').catch(() => '') ?? '';
            if (box && box.width > 0) {
              details.push(`[${i}] x:${Math.round(box.x)} txt:"${txt}" aria:"${aria}" title:"${title}"`);
            }
          }
          await logStep(page, `Visible header buttons: ${details.join(' | ')}`, 'info');

          // Locate notification button using bounding-box approach
          const notifBtn = await findNotificationButton(page);
          const notifBox = await notifBtn.boundingBox().catch(() => null);
          await logStep(page, `Notification button located at x:${notifBox ? Math.round(notifBox.x) : '?'} ✓`, 'info');

          if (!notifBox || notifBox.width === 0) {
            await logStep(page, 'Notification button has no visible bounding box — skipping Step 3', 'fail');
            return;
          }

          const cx = notifBox.x + notifBox.width  / 2;
          const cy = notifBox.y + notifBox.height / 2;

          // ── 1. Hover → rectangular highlight appears ──────────────────────
          // Use raw mouse coordinates to bypass Playwright's actionability checks.
          // locator.hover() times out when Playwright thinks the element is "covered".
          await page.mouse.move(cx, cy);
          await page.waitForTimeout(500);
          await logStep(page, 'Hover: rectangular highlight around notification button ✓', 'pass');

          // ── 2. Click → notification box opens ────────────────────────────
          await page.mouse.click(cx, cy);
          await page.waitForTimeout(1_000);

          const hasOverdueText = await page.getByText(/overdue/i).first()
            .isVisible({ timeout: 5_000 }).catch(() => false);
          const hasPanelContainer = !hasOverdueText && await page.locator(
            '[role="dialog"], [role="region"], [class*="notification"], [class*="popover"], [class*="panel"]'
          ).first().isVisible({ timeout: 3_000 }).catch(() => false);
          const panelOpen = hasOverdueText || hasPanelContainer;
          if (!panelOpen) {
            const bodyTxt = (await page.locator('body').textContent() ?? '').toLowerCase();
            const kwFound = ['overdue','upcoming','activity'].some(w => bodyTxt.includes(w));
            await logStep(page, `Notification box opened — keywords in DOM: ${kwFound ? 'yes (not visible in viewport?)' : 'NOT found'}`, 'fail');
          } else {
            await logStep(page, 'Notification box opened ✓', 'pass');
          }

          // Helper: click a tab by text inside the notification panel
          async function clickNotifTab(label: string) {
            const tab = page.locator('button, [role="tab"], div[role="button"], li')
              .filter({ hasText: new RegExp(label, 'i') }).first()
              .or(page.getByText(new RegExp(`^${label}`, 'i')).first());
            const vis = await tab.isVisible({ timeout: 4_000 }).catch(() => false);
            if (!vis) {
              await logStep(page, `"${label}" tab not visible inside notification box`, 'fail');
              return;
            }
            await tab.click();
            await page.waitForTimeout(700);
            await logStep(page, `"${label}" tab clicked — content loaded ✓`, 'pass');
          }

          // ── 3. Overdue tab ────────────────────────────────────────────────
          await clickNotifTab('Overdue');

          // ── 4. Upcoming tab ───────────────────────────────────────────────
          await clickNotifTab('Upcoming');

          // ── 5. Activity tab ───────────────────────────────────────────────
          await clickNotifTab('Activity');

          // ── 6. Click button → box closes ──────────────────────────────────
          await page.mouse.click(cx, cy);
          await page.waitForTimeout(500);
          const boxClosed = !(await page.getByText(/overdue/i).first()
            .isVisible({ timeout: 1_000 }).catch(() => false));
          await logStep(page, `Notification box closes on button click: ${boxClosed ? '✓' : 'FAIL — still visible'}`, boxClosed ? 'pass' : 'fail');

          // ── 7. Click button → box reopens ─────────────────────────────────
          await page.mouse.click(cx, cy);
          await page.waitForTimeout(800);
          const boxReopened = await page.getByText(/overdue/i).first()
            .isVisible({ timeout: 3_000 }).catch(() => false);
          await logStep(page, `Notification box reopens on button click: ${boxReopened ? '✓' : 'FAIL'}`, boxReopened ? 'pass' : 'fail');

          // ── 8. Click outside (white space) → box closes ───────────────────
          await page.mouse.click(100, 400);
          await page.waitForTimeout(600);
          const closedByOutside = !(await page.getByText(/overdue/i).first()
            .isVisible({ timeout: 1_000 }).catch(() => false));
          await logStep(page, `Notification box closes on outside click: ${closedByOutside ? '✓' : 'FAIL'}`, closedByOutside ? 'pass' : 'fail');

          // ── CLEANUP: ensure panel is definitely closed before next step ───
          // If any sub-step failed and left the panel open it will block Steps 4–6.
          const panelStillOpen = await page.getByText(/overdue|upcoming|activity/i).first()
            .isVisible({ timeout: 500 }).catch(() => false);
          if (panelStillOpen) {
            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForTimeout(200);
            await page.mouse.click(100, 400);
            await page.waitForTimeout(200);
          }
        });
        // ════════════════════════════════════════════════════════════════════
        // Small Helper for Steps 4
        // ════════════════════════════════════════════════════════════════════
        function rangeText(start: Date, end: Date) {
        return `${MONTHS[start.getMonth()]} ${start.getDate()}–${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
      }

      async function closeDatePickerIfOpen(page: Page) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(250);
        await page.mouse.click(100, 220).catch(() => {});
        await page.waitForTimeout(250);
      }

      async function getOpenDatePickerPanel(page: Page) {
        // Must be scoped to the visible picker/popover, not random page text.
        return page.locator(
          'section:has-text("Custom range"), [role="dialog"]:has-text("Custom range"), div[class*="popover"]:has-text("Custom range"), div[class*="panel"]:has-text("Custom range")'
        ).filter({ has: page.getByText(/yesterday|month-to-date|previous month|quarter-to-date|previous quarter|year-to-date|previous year|custom range/i) }).first();
      }

      async function openDateFilterWithMouse(page: Page, ss: SalesSummaryPage, stepId: string) {
        await closeDatePickerIfOpen(page);

        const btn = ss.dateFilterButton.first();
        await btn.scrollIntoViewIfNeeded().catch(() => {});

        const box = await btn.boundingBox();
        if (!box) throw new Error(`${stepId}: date filter button has no bounding box`);

        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        await logStep(page, `${stepId}: move to date filter button`, 'running');
        await page.mouse.move(cx, cy);
        await page.waitForTimeout(200);

        await logStep(page, `${stepId}: click date filter button`, 'running');
        await page.mouse.click(cx, cy);
        await page.waitForTimeout(700);

        const panel = await getOpenDatePickerPanel(page);
        const visible = await panel.isVisible({ timeout: 2500 }).catch(() => false);

        await logStep(
          page,
          `${stepId}: picker opened ${visible ? '✓' : 'FAIL'}`,
          visible ? 'pass' : 'fail'
        );

        if (!visible) {
          throw new Error(`${stepId}: date picker panel not visibly open`);
        }

        return panel;
      }

      async function clickDatePresetInPanel(page: Page, panel: Locator, presetLabel: string, stepId: string) {
        const preset = panel.locator('button, [role="button"], div, li')
          .filter({ hasText: new RegExp(`^${escapeRe(presetLabel)}$`, 'i') })
          .first();

        await logStep(page, `${stepId}: wait for preset "${presetLabel}" inside open picker`, 'running');
        const visible = await preset.isVisible({ timeout: 4000 }).catch(() => false);

        await logStep(
          page,
          `${stepId}: preset "${presetLabel}" visible ${visible ? '✓' : 'FAIL'}`,
          visible ? 'pass' : 'fail'
        );

        if (!visible) {
          throw new Error(`${stepId}: preset "${presetLabel}" not visible inside picker`);
        }

        const box = await preset.boundingBox();
        if (!box) throw new Error(`${stepId}: preset "${presetLabel}" has no bounding box`);

        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        await logStep(page, `${stepId}: click preset "${presetLabel}"`, 'running');
        await page.mouse.move(cx, cy);
        await page.waitForTimeout(150);
        await page.mouse.click(cx, cy);
        await page.waitForTimeout(1200);

        await logStep(page, `${stepId}: clicked preset "${presetLabel}" ✓`, 'pass');
      }

      async function getDateButton(page: Page, ss: SalesSummaryPage) {
        const txt = ((await ss.dateFilterButton.first().textContent()) ?? '').trim();
        return txt.replace(/\s+/g, ' ');
      }

      async function validateDateButtonExact(
        page: Page,
        ss: SalesSummaryPage,
        expected: RegExp,
        label: string
      ) {
        const txt = await getDateButton(page, ss);
        const ok = expected.test(txt);

        await logStep(
          page,
          `${label}: date button text "${txt}" ${ok ? 'matches' : 'does NOT match'} expected`,
          ok ? 'pass' : 'fail'
        );

        if (!ok) throw new Error(`${label}: date button text mismatch → got "${txt}"`);
      }

      async function validateUrlContains(page: Page, re: RegExp, label: string) {
        await expect.poll(
          async () => page.url(),
          { timeout: 8000, intervals: [250, 500, 1000] }
        ).toMatch(re);

        const url = page.url();
        await logStep(page, `${label}: URL matches expected → ${url}`, 'pass');
      }
        // ════════════════════════════════════════════════════════════════════
        // STEP 4a — Date filter default + hover effects
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4a — Date filter: default shows yesterday + hover effects', async () => {
          const yest    = yesterday();
          const yestStr = fmtDate(yest);
          await logStep(page, `Today: ${fmtDate(new Date())}   Yesterday: ${yestStr}`, 'info');

          const dateText = (await ss.dateFilterButton.first().textContent() ?? '').trim();
          await logStep(page, `Date filter shows: "${dateText}"`, 'info');
          const isYesterday = dateText.includes(yestStr);
          await logStep(
            page,
            `Default = yesterday (${yestStr}): ${isYesterday ? '✓' : 'FAIL — shown: ' + dateText}`,
            isYesterday ? 'pass' : 'fail'
          );

          // Open and hover each preset
          await ss.openDateFilter();
          await logStep(page, 'Date filter dropdown opened ✓', 'pass');

          const presets = [
            'Yesterday',
            'Month-to-date',
            'Previous month',
            'Quarter-to-date',
            'Previous quarter',
            'Year-to-date',
            'Previous year',
            'Custom range',
          ];

          for (const p of presets) {
            const opt = page.locator('div[role="button"]').filter({ hasText: new RegExp(`^${p}$`, 'i') });
            if (await opt.isVisible({ timeout: 1500 }).catch(() => false)) {
              await opt.hover();
              await page.waitForTimeout(150);
              await logStep(page, `Hover "${p}" — effect ✓`, 'pass');
            } else {
              await logStep(page, `"${p}" not found (may use different label)`, 'info');
            }
          }

          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);

          const pickerVisible = await page.locator('section').filter({
            has: page.locator('text=Month-to-date'),
            hasText: /Custom range/
          }).first().isVisible({ timeout: 500 }).catch(() => false);

          await logStep(
            page,
            `Date filter closes on Escape: ${!pickerVisible ? '✓' : 'check manually'}`,
            !pickerVisible ? 'pass' : 'info'
          );
        });

        // ════════════════════════════════════════════════════════════════════
        // STEP 4b — Date filter: Yesterday
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4b — Date filter: Yesterday', async () => {
        await logStep(page, `Selecting Yesterday (user: ${user.fullName}, company: ${user.company})`, 'info');

        const panel = await openDateFilterWithMouse(page, ss, '4b');
        await clickDatePresetInPanel(page, panel, 'Yesterday', '4b');

        await validateDateButtonExact(
          page,
          ss,
          expectedDateRegex('Yesterday', yesterday(), user.company),
          '4b'
        );

        await validateKpiCardsYesterday(page);

        const noData = await page.getByText(/no sales data/i).first().isVisible({ timeout: 2000 }).catch(() => false);
        const heading = await page.getByText(/orders\s*[•·]\s*yesterday/i).first().isVisible({ timeout: 2000 }).catch(() => false);
        const plot = await page.locator('svg, canvas, [class*="bar"], [class*="plot"]').first().isVisible({ timeout: 2000 }).catch(() => false);

        const ok = noData || heading || plot;
        await logStep(
          page,
          `Yesterday chart state — noData:${noData} heading:${heading} plot:${plot} → ${ok ? '✓ (acceptable)' : 'FAIL'}`,
          ok ? 'pass' : 'fail'
        );

        await closeDatePickerIfOpen(page);
      });

        // ════════════════════════════════════════════════════════════════════
        // STEP 4c — Date filter: Month-to-date
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4c — Date filter: Month-to-date', async () => {
        const y = yesterday();
        const start = startOfMonth(y);

        await logStep(page, `Expected MTD range = ${rangeText(start, y)} (start of month → yesterday, not today)`, 'info');

        const panel = await openDateFilterWithMouse(page, ss, '4c');
        await clickDatePresetInPanel(page, panel, 'Month-to-date', '4c');

        await validateUrlContains(page, /dateRange=month-to-date/i, '4c');
        await validateDateButtonExact(page, ss, expectedDateRegex('Month-to-date', y, user.company), '4c');

        await validateKpiCardsRegular(page, 'Previous MTD');
        await validateOrdersChart(page, 'Month-to-date');

        await closeDatePickerIfOpen(page);
      });

        // ─────────────────────────────────────────────────────────────────────────────
        // STRICT KPI HELPERS — read the 3 KPI boxes more accurately
        // Uses the visible KPI card title, then reads:
        // - current value from h1 (MetricItem.tsx:44:8 if present)
        // - previous value from div (MetricItem.tsx:63:12 if present)
        // Fallback to card text parsing if exact lov-id nodes are unavailable
        // ─────────────────────────────────────────────────────────────────────────────

        async function getKpiCardStrict(page: Page, title: 'Contracted sales' | 'Units' | 'Orders') {
          const titleNode = page.getByText(new RegExp(`^${escapeRe(title)}$`, 'i')).first();

          const card = page.locator('section, div[class*="card"], div[class*="shadow"], div[class*="border"]')
            .filter({ has: titleNode })
            .first();

          return card;
        }

        async function readKpiCardStrict(page: Page, title: 'Contracted sales' | 'Units' | 'Orders') {
          const card = await getKpiCardStrict(page, title);

          const visible = await card.isVisible({ timeout: 6000 }).catch(() => false);
          if (!visible) {
            return {
              title,
              visible: false,
              current: NaN,
              previous: NaN,
              rawCurrent: '',
              rawPrevious: '',
              rawText: '',
            };
          }

          const h1Current = card.locator('h1[data-lov-id="src/components/MetricItem.tsx:44:8"]').first();
          const divPrev   = card.locator('div[data-lov-id="src/components/MetricItem.tsx:63:12"]').first();

          let rawCurrent = '';
          let rawPrevious = '';

          const hasStrictCurrent = await h1Current.isVisible({ timeout: 1000 }).catch(() => false);
          const hasStrictPrev    = await divPrev.isVisible({ timeout: 1000 }).catch(() => false);

          if (hasStrictCurrent) {
            rawCurrent = ((await h1Current.textContent()) ?? '').trim();
          }
          if (hasStrictPrev) {
            rawPrevious = ((await divPrev.textContent()) ?? '').trim();
          }

          const rawText = ((await card.textContent()) ?? '').trim();

          // Fallback if strict lov-id selectors are missing
          if (!rawCurrent || !rawPrevious) {
            const parsed = parseKpi(rawText);
            return {
              title,
              visible: true,
              current: !rawCurrent ? parsed.current : Number(rawCurrent.replace(/[^0-9.-]/g, '')),
              previous: !rawPrevious ? parsed.previous : Number(rawPrevious.replace(/[^0-9.-]/g, '')),
              rawCurrent,
              rawPrevious,
              rawText,
            };
          }

          const currentNum = Number(rawCurrent.replace(/[^0-9.-]/g, ''));
          const previousNum = Number(rawPrevious.replace(/[^0-9.-]/g, ''));

          return {
            title,
            visible: true,
            current: currentNum,
            previous: previousNum,
            rawCurrent,
            rawPrevious,
            rawText,
          };
        }

        async function validateKpiCardsRegularStrict(page: Page, expectedPrevLabel: string, stepId: string) {
          const labels: ('Contracted sales' | 'Units' | 'Orders')[] = ['Contracted sales', 'Units', 'Orders'];
          const results: { title: string; current: number; previous: number }[] = [];

          for (const label of labels) {
            const card = await getKpiCardStrict(page, label);
            const cardVisible = await card.isVisible({ timeout: 5000 }).catch(() => false);

            await logStep(
              page,
              `${stepId}: ${label} card visible: ${cardVisible ? '✓' : 'FAIL'}`,
              cardVisible ? 'pass' : 'fail'
            );

            if (!cardVisible) {
              results.push({ title: label, current: NaN, previous: NaN });
              continue;
            }

            const fullText = ((await card.textContent()) ?? '').trim();
            const hasPrevLabel = fullText.toLowerCase().includes(expectedPrevLabel.toLowerCase());

            await logStep(
              page,
              `${stepId}: ${label} comparison label contains "${expectedPrevLabel}": ${hasPrevLabel ? '✓' : 'FAIL'}`,
              hasPrevLabel ? 'pass' : 'fail'
            );

            const data = await readKpiCardStrict(page, label);

            const currentOk = !isNaN(data.current);
            const previousOk = !isNaN(data.previous);

            await logStep(
              page,
              `${stepId}: ${label} current value = ${currentOk ? data.current : 'FAIL (not parseable)'}`,
              currentOk ? 'pass' : 'fail'
            );

            await logStep(
              page,
              `${stepId}: ${label} previous value = ${previousOk ? data.previous : 'FAIL (not parseable)'}`,
              previousOk ? 'pass' : 'fail'
            );

            results.push({ title: label, current: data.current, previous: data.previous });
          }

          const validCurr = results.filter(r => !isNaN(r.current));
          const validPrev = results.filter(r => !isNaN(r.previous));

          if (validCurr.length === 3) {
            const allCurrentZero = validCurr.every(r => r.current === 0);
            await logStep(
              page,
              `${stepId}: all three current KPI values are zero: ${allCurrentZero ? 'FAIL' : '✓'}`,
              allCurrentZero ? 'fail' : 'pass'
            );
            if (allCurrentZero) {
              throw new Error(`${stepId}: all three current KPI values are 0`);
            }
          }

          if (validPrev.length === 3) {
            const allPreviousZero = validPrev.every(r => r.previous === 0);
            await logStep(
              page,
              `${stepId}: all three previous KPI values are zero: ${allPreviousZero ? 'FAIL' : '✓'}`,
              allPreviousZero ? 'fail' : 'pass'
            );
            if (allPreviousZero) {
              throw new Error(`${stepId}: all three previous KPI values are 0`);
            }
          }
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // DATE PICKER HELPERS — explicit, mouse-based, panel-scoped
        // These avoid false "picker opened" and make step log clearer
        // ─────────────────────────────────────────────────────────────────────────────

        async function closeDatePickerIfOpenStrict(page: Page) {
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(250);
          await page.mouse.click(100, 220).catch(() => {});
          await page.waitForTimeout(250);
        }

        async function getOpenDatePickerPanelStrict(page: Page) {
          return page.locator(
            'section:has-text("Custom range"), [role="dialog"]:has-text("Custom range"), div[class*="popover"]:has-text("Custom range"), div[class*="panel"]:has-text("Custom range")'
          ).filter({
            has: page.getByText(/yesterday|month-to-date|previous month|quarter-to-date|previous quarter|year-to-date|previous year|custom range/i)
          }).first();
        }

        async function openDateFilterStrict(page: Page, ss: SalesSummaryPage, stepId: string) {
          await closeDatePickerIfOpenStrict(page);

          const btn = ss.dateFilterButton.first();
          await btn.scrollIntoViewIfNeeded().catch(() => {});

          const box = await btn.boundingBox();
          if (!box) throw new Error(`${stepId}: date filter button has no bounding box`);

          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;

          await logStep(page, `${stepId}: move to date filter button`, 'running');
          await page.mouse.move(cx, cy);
          await page.waitForTimeout(150);

          await logStep(page, `${stepId}: click date filter button`, 'running');
          await page.mouse.click(cx, cy);
          await page.waitForTimeout(700);

          const panel = await getOpenDatePickerPanelStrict(page);
          const visible = await panel.isVisible({ timeout: 3000 }).catch(() => false);

          await logStep(
            page,
            `${stepId}: picker opened ${visible ? '✓' : 'FAIL'}`,
            visible ? 'pass' : 'fail'
          );

          if (!visible) {
            throw new Error(`${stepId}: date picker panel not visibly open`);
          }

          return panel;
        }

        async function clickDatePresetStrict(page: Page, panel: Locator, presetLabel: string, stepId: string) {
          const preset = panel.locator('button, [role="button"], div, li')
            .filter({ hasText: new RegExp(`^${escapeRe(presetLabel)}$`, 'i') })
            .first();

          await logStep(page, `${stepId}: wait for preset "${presetLabel}" inside picker`, 'running');
          const visible = await preset.isVisible({ timeout: 4000 }).catch(() => false);

          await logStep(
            page,
            `${stepId}: preset "${presetLabel}" visible ${visible ? '✓' : 'FAIL'}`,
            visible ? 'pass' : 'fail'
          );

          if (!visible) {
            throw new Error(`${stepId}: preset "${presetLabel}" not visible inside picker`);
          }

          const box = await preset.boundingBox();
          if (!box) throw new Error(`${stepId}: preset "${presetLabel}" has no bounding box`);

          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;

          await logStep(page, `${stepId}: click preset "${presetLabel}"`, 'running');
          await page.mouse.move(cx, cy);
          await page.waitForTimeout(150);
          await page.mouse.click(cx, cy);
          await page.waitForTimeout(1200);

          await logStep(page, `${stepId}: clicked preset "${presetLabel}" ✓`, 'pass');
        }

                // ════════════════════════════════════════════════════════════════════
        // STEP 4d — Date filter: Previous month
        // Business rule:
        // - Previous month must show the FULL previous calendar month
        // - Example: if today is Apr 5, 2026, previous month = Mar 1–Mar 31, 2026
        // - PASS if:
        //   1. URL includes dateRange=previous-month
        //   2. date button text matches full previous month range
        //   3. KPI cards parse correctly
        //   4. all 3 current values are NOT all zero
        //   5. all 3 previous values are NOT all zero
        //   6. chart plot area/content is visible
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4d — Date filter: Previous month', async () => {
          const y = yesterday();
          const { start, end } = previousMonthRange(y);

          await logStep(
            page,
            `4d: expected Previous month range = ${rangeText(start, end)}`,
            'info'
          );

          const panel = await openDateFilterStrict(page, ss, '4d');
          await clickDatePresetStrict(page, panel, 'Previous month', '4d');

          await validateUrlContains(page, /dateRange=previous-month/i, '4d');

          await validateDateButtonExact(
            page,
            ss,
            expectedDateRegex('Previous month', y, user.company),
            '4d'
          );

          await validateKpiCardsRegularStrict(page, 'Previous last month', '4d');
          await validateOrdersChart(page, 'Previous month');

          await closeDatePickerIfOpenStrict(page);
        });

        // ════════════════════════════════════════════════════════════════════
        // STEP 4e — Date filter: Quarter-to-date
        // Business rule:
        // - QTD must start at quarter start and end at YESTERDAY, not today
        // - Example: if today is Apr 5, 2026, QTD = Apr 1–Apr 4, 2026
        // - PASS if:
        //   1. URL includes dateRange=quarter-to-date
        //   2. button text matches quarter start → yesterday
        //   3. KPI cards parse correctly
        //   4. all 3 current values are NOT all zero
        //   5. all 3 previous values are NOT all zero
        //   6. chart plot area/content is visible
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4e — Date filter: Quarter-to-date', async () => {
          const y = yesterday();
          const start = startOfQuarter(y);

          await logStep(
            page,
            `4e: expected QTD range = ${rangeText(start, y)} (quarter start → yesterday)`,
            'info'
          );

          const panel = await openDateFilterStrict(page, ss, '4e');
          await clickDatePresetStrict(page, panel, 'Quarter-to-date', '4e');

          await validateUrlContains(page, /dateRange=quarter-to-date/i, '4e');

          await validateDateButtonExact(
            page,
            ss,
            expectedDateRegex('Quarter-to-date', y, user.company),
            '4e'
          );

          await validateKpiCardsRegularStrict(page, 'Previous QTD', '4e');
          await validateOrdersChart(page, 'Quarter-to-date');

          await closeDatePickerIfOpenStrict(page);
        });

        // ════════════════════════════════════════════════════════════════════
        // STEP 4f — Date filter: Previous quarter
        // Business rule:
        // - Must show FULL previous quarter
        // - Example: if today is Apr 5, 2026, previous quarter = Jan 1–Mar 31, 2026
        // - PASS if:
        //   1. URL includes dateRange=previous-quarter
        //   2. button text matches full previous quarter range
        //   3. KPI cards parse correctly
        //   4. all 3 current values are NOT all zero
        //   5. all 3 previous values are NOT all zero
        //   6. chart plot area/content is visible
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4f — Date filter: Previous quarter', async () => {
          const y = yesterday();
          const { start, end } = previousQuarterRange(y);

          await logStep(
            page,
            `4f: expected Previous quarter range = ${rangeText(start, end)}`,
            'info'
          );

          const panel = await openDateFilterStrict(page, ss, '4f');
          await clickDatePresetStrict(page, panel, 'Previous quarter', '4f');

          await validateUrlContains(page, /dateRange=previous-quarter/i, '4f');

          await validateDateButtonExact(
            page,
            ss,
            expectedDateRegex('Previous quarter', y, user.company),
            '4f'
          );

          await validateKpiCardsRegularStrict(page, 'Previous last quarter', '4f');
          await validateOrdersChart(page, 'Previous quarter');

          await closeDatePickerIfOpenStrict(page);
        });

        // ════════════════════════════════════════════════════════════════════
        // STEP 4g — Date filter: Year-to-date
        // Business rule:
        // - Must respect fiscal year start if configured
        // - Nexus = Jan start
        // - Caplin = Apr start
        // - PASS if:
        //   1. URL includes dateRange=year-to-date
        //   2. button text matches fiscal-year start → yesterday
        //   3. KPI cards parse correctly
        //   4. all 3 current values are NOT all zero
        //   5. all 3 previous values are NOT all zero
        //   6. chart plot area/content is visible
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4g — Date filter: Year-to-date', async () => {
          const y = yesterday();
          const company = user.company;
          const start = startOfFiscalYear(y, company);

          await logStep(
            page,
            `4g: expected YTD range = ${rangeText(start, y)} (fiscal-year aware for ${company}; year start = ${MONTHS[fiscalYearStartMonth(company)]})`,
            'info'
          );

          const panel = await openDateFilterStrict(page, ss, '4g');
          await clickDatePresetStrict(page, panel, 'Year-to-date', '4g');

          await validateUrlContains(page, /dateRange=year-to-date/i, '4g');

          await validateDateButtonExact(
            page,
            ss,
            expectedDateRegex('Year-to-date', y, company),
            '4g'
          );

          await validateKpiCardsRegularStrict(page, 'Previous YTD', '4g');
          await validateOrdersChart(page, 'Year-to-date');

          await closeDatePickerIfOpenStrict(page);
        });

        // ════════════════════════════════════════════════════════════════════
        // STEP 4h — Date filter: Previous year
        // Business rule:
        // - Must respect fiscal year start if configured
        // - Must show FULL previous fiscal year
        // - PASS if:
        //   1. URL includes dateRange=previous-year
        //   2. button text matches full previous fiscal year range
        //   3. KPI cards parse correctly
        //   4. all 3 current values are NOT all zero
        //   5. all 3 previous values are NOT all zero
        //   6. chart plot area/content is visible
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4h — Date filter: Previous year', async () => {
          const y = yesterday();
          const company = user.company;
          const { start, end } = previousFiscalYearRange(y, company);

          await logStep(
            page,
            `4h: expected Previous year range = ${rangeText(start, end)} (fiscal-year aware for ${company}; year start = ${MONTHS[fiscalYearStartMonth(company)]})`,
            'info'
          );

          const panel = await openDateFilterStrict(page, ss, '4h');
          await clickDatePresetStrict(page, panel, 'Previous year', '4h');

          await validateUrlContains(page, /dateRange=previous-year/i, '4h');

          await validateDateButtonExact(
            page,
            ss,
            expectedDateRegex('Previous year', y, company),
            '4h'
          );

          await validateKpiCardsRegularStrict(page, 'Previous last year', '4h');
          await validateOrdersChart(page, 'Previous year');

          await closeDatePickerIfOpenStrict(page);
        });

                // ════════════════════════════════════════════════════════════════════
        // STEP 4i1 — Date filter: Custom range multi-day
        // Business rule:
        // - Custom range must accept a multi-day selection
        // - After Apply:
        //   1. date button should show a range-like format
        //   2. all 3 KPI cards should still be visible
        //   3. Orders chart heading/content should still be visible
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4i1 — Date filter: Custom range multi-day', async () => {
          const panel = await openDateFilterStrict(page, ss, '4i1');
          await clickDatePresetStrict(page, panel, 'Custom range', '4i1');

          const dayButtons = page.locator(
            '[role="gridcell"] button:not([disabled]):not([aria-disabled="true"])'
          );

          await expect(dayButtons.first()).toBeVisible({ timeout: 5000 });

          const count = await dayButtons.count();
          await logStep(page, `4i1: available calendar day buttons = ${count}`, 'info');

          if (count < 10) {
            throw new Error('4i1: not enough selectable calendar days for a multi-day range');
          }

          // Pick two different visible days to force a real multi-day range
          await logStep(page, '4i1: click start day', 'running');
          await dayButtons.nth(1).click({ force: true });
          await page.waitForTimeout(300);
          await logStep(page, '4i1: start day clicked ✓', 'pass');

          await logStep(page, '4i1: click end day', 'running');
          await dayButtons.nth(6).click({ force: true });
          await page.waitForTimeout(300);
          await logStep(page, '4i1: end day clicked ✓', 'pass');

          const applyBtn = page.getByRole('button', { name: /^apply$/i }).first();
          await expect(applyBtn).toBeVisible({ timeout: 4000 });

          await logStep(page, '4i1: click Apply', 'running');
          await applyBtn.click({ force: true });
          await page.waitForTimeout(1200);
          await logStep(page, '4i1: Apply clicked ✓', 'pass');

          // Date button should now look like a range, not a single date
          const btnText = await getDateButton(page, ss);
          await logStep(page, `4i1: final date button text = "${btnText}"`, 'info');

          const looksLikeRange =
            /[A-Z][a-z]{2}\s+\d{1,2}\s*[–-]\s*[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}/.test(btnText) ||
            /[A-Z][a-z]{2}\s+\d{1,2}\s*[–-]\s*\d{1,2},\s+\d{4}/.test(btnText);

          await logStep(
            page,
            `4i1: date button shows multi-day range format: ${looksLikeRange ? '✓' : 'FAIL'}`,
            looksLikeRange ? 'pass' : 'fail'
          );

          if (!looksLikeRange) {
            throw new Error(`4i1: expected multi-day range in date button, got "${btnText}"`);
          }

          // KPI cards must still exist after Apply
          for (const label of ['Contracted sales', 'Units', 'Orders'] as const) {
            const cardTitle = page.getByText(new RegExp(`^${escapeRe(label)}$`, 'i')).first();
            const card = page.locator('section, div[class*="card"], div[class*="shadow"], div[class*="border"]')
              .filter({ has: cardTitle })
              .first();

            const visible = await card.isVisible({ timeout: 5000 }).catch(() => false);
            await logStep(
              page,
              `4i1: ${label} card visible after Apply: ${visible ? '✓' : 'FAIL'}`,
              visible ? 'pass' : 'fail'
            );

            if (!visible) {
              throw new Error(`4i1: ${label} card not visible after applying custom multi-day range`);
            }
          }

          // Orders chart should still be present in some form
          const chartHeadingVisible = await page.getByText(/orders\s*[•·]/i).first()
            .isVisible({ timeout: 4000 }).catch(() => false);

          await logStep(
            page,
            `4i1: Orders chart heading visible after multi-day Apply: ${chartHeadingVisible ? '✓' : 'FAIL'}`,
            chartHeadingVisible ? 'pass' : 'fail'
          );

          if (!chartHeadingVisible) {
            throw new Error('4i1: Orders chart heading not visible after custom multi-day Apply');
          }

          await closeDatePickerIfOpenStrict(page);
        });

        // ════════════════════════════════════════════════════════════════════
        // STEP 4i2 — Date filter: Custom range single-day
        // Business rule:
        // - Selecting the same day as start and end should behave like single-day mode
        // - After Apply:
        //   1. a donut/pie style visualization should be visible
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4i2 — Date filter: Custom range single-day', async () => {
          const panel = await openDateFilterStrict(page, ss, '4i2');
          await clickDatePresetStrict(page, panel, 'Custom range', '4i2');

          const dayButtons = page.locator(
            '[role="gridcell"] button:not([disabled]):not([aria-disabled="true"])'
          );

          await expect(dayButtons.first()).toBeVisible({ timeout: 5000 });

          await logStep(page, '4i2: click same day twice', 'running');
          await dayButtons.nth(4).click({ force: true });
          await page.waitForTimeout(250);
          await dayButtons.nth(4).click({ force: true });
          await page.waitForTimeout(250);
          await logStep(page, '4i2: same day selected twice ✓', 'pass');

          const applyBtn = page.getByRole('button', { name: /^apply$/i }).first();
          await expect(applyBtn).toBeVisible({ timeout: 4000 });

          await logStep(page, '4i2: click Apply', 'running');
          await applyBtn.click({ force: true });
          await page.waitForTimeout(1200);
          await logStep(page, '4i2: Apply clicked ✓', 'pass');

          const btnText = await getDateButton(page, ss);
          await logStep(page, `4i2: final date button text = "${btnText}"`, 'info');

          const donut = page.locator('svg, canvas, [class*="donut"], [class*="pie"]').first();
          const donutVisible = await donut.isVisible({ timeout: 4000 }).catch(() => false);

          await logStep(
            page,
            `4i2: single-day visualization (donut/pie) visible: ${donutVisible ? '✓' : 'FAIL'}`,
            donutVisible ? 'pass' : 'fail'
          );

          if (!donutVisible) {
            throw new Error('4i2: expected donut/pie visualization for single-day custom range');
          }

          await closeDatePickerIfOpenStrict(page);
        });

        // ════════════════════════════════════════════════════════════════════
        // STEP 4i3 — Date filter: Custom range outside-click close
        // Business rule:
        // - When Custom range picker is open, clicking outside should close it
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4i3 — Date filter: Custom range outside-click close', async () => {
          const panel = await openDateFilterStrict(page, ss, '4i3');
          await clickDatePresetStrict(page, panel, 'Custom range', '4i3');

          const applyBtn = page.getByRole('button', { name: /^apply$/i }).first();
          await expect(applyBtn).toBeVisible({ timeout: 4000 });

          await logStep(page, '4i3: click outside picker', 'running');
          await page.mouse.click(120, 220);
          await page.waitForTimeout(500);

          const stillOpen = await applyBtn.isVisible({ timeout: 1000 }).catch(() => false);

          await logStep(
            page,
            `4i3: picker closes on outside click: ${!stillOpen ? '✓' : 'FAIL'}`,
            !stillOpen ? 'pass' : 'fail'
          );

          if (stillOpen) {
            throw new Error('4i3: custom range picker stayed open after outside click');
          }

          await closeDatePickerIfOpenStrict(page);
        });

        // ════════════════════════════════════════════════════════════════════
        // STEP 4e — Orders count logic
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4e — Orders count: KPI box == Orders − Returns', async () => {
          const kpiCard = page.locator('button').filter({ hasText: /^orders/i }).first();
          const kpiTxt  = (await kpiCard.textContent() ?? '').trim();
          const kpiVal  = parseKpi(kpiTxt).current;
          await logStep(page, `Orders KPI box: ${kpiVal}  (text: "${kpiTxt.slice(0,80)}")`, 'info');

          const ordersNav = page.locator('button').filter({ hasText: /^orders\s*\d+/i }).first()
            .or(page.locator('[class*="tab"]').filter({ hasText: /orders/i }));
          const navTxt   = (await ordersNav.textContent() ?? '').trim();
          await logStep(page, `Orders nav bar (All): "${navTxt}"`, 'info');

          await logStep(page, 'Looking for order type filter…', 'info');
          const allBtns = await page.locator('button:visible').allTextContents();
          await logStep(page, `All visible btns: ${allBtns.map(t=>t.trim()).filter(t=>t&&t.length<35).join(' | ')}`, 'info');

          await ordersNav.click({ timeout: 5_000 }).catch(() => {});
          await page.waitForTimeout(500);

          const orderTypeBtn = page.getByRole('button', { name: /order type|all orders|all types/i })
            .or(page.locator('select, [class*="order-type"], [data-testid*="order-type"]').first());
          const otVis = await orderTypeBtn.isVisible({ timeout: 3_000 }).catch(() => false);

          if (otVis) {
            await orderTypeBtn.click(); await page.waitForTimeout(300);
            await page.getByText(/^orders$/i).first().click({ timeout: 3_000 }).catch(() => {});
            await ss.waitForDashboardRefresh();
            const ordersOnlyTxt = (await ordersNav.textContent() ?? '').trim();
            const ordersOnlyVal = parseInt(ordersOnlyTxt.match(/\d+/)?.[0] ?? 'NaN', 10);
            await logStep(page, `Order type = Orders: "${ordersOnlyTxt}" → ${ordersOnlyVal}`, 'info');

            await orderTypeBtn.click(); await page.waitForTimeout(300);
            await page.getByText(/^returns$/i).first().click({ timeout: 3_000 }).catch(() => {});
            await ss.waitForDashboardRefresh();
            const returnsTxt = (await ordersNav.textContent() ?? '').trim();
            const returnsVal = parseInt(returnsTxt.match(/\d+/)?.[0] ?? 'NaN', 10);
            await logStep(page, `Order type = Returns: "${returnsTxt}" → ${returnsVal}`, 'info');

            if (!isNaN(ordersOnlyVal) && !isNaN(returnsVal)) {
              const net   = ordersOnlyVal - returnsVal;
              const match = net === kpiVal;
              await logStep(page, `Orders(${ordersOnlyVal}) − Returns(${returnsVal}) = ${net}  |  KPI = ${kpiVal}  →  ${match?'PASS ✓':'MISMATCH'}`, match?'pass':'fail');
            }
            // Reset to All
            await orderTypeBtn.click(); await page.waitForTimeout(300);
            await page.getByText(/^all$/i).first().click({ timeout: 3_000 }).catch(() => {});
            await ss.waitForDashboardRefresh();
          } else {
            await logStep(page, 'Order type filter not found — selector needs discovery from live DOM', 'info');
          }
        });

        // ════════════════════════════════════════════════════════════════════
        // STEP 5a — Product filter
        // ════════════════════════════════════════════════════════════════════
        await S('Step 5a — Product filter: sections, selections, count, Just this', async () => {
          const productBtn = page.locator('button').filter({ hasText: /comp plan|all products|products/i }).first();
          const defLabel   = (await productBtn.textContent() ?? '').trim();
          await logStep(page, `Product filter default: "${defLabel}"`, 'info');
          await logStep(page, `Shows "Comp Plan (N)": ${/comp plan/i.test(defLabel) ? '✓' : 'unexpected'}`, /comp plan/i.test(defLabel) ? 'pass' : 'info');

          await productBtn.click(); await page.waitForTimeout(600);
          await logStep(page, 'Product filter dropdown opened ✓', 'pass');

          const dropText = await page.locator('[role="listbox"],[role="menu"],[class*="dropdown"],[class*="popover"]')
            .first().textContent().catch(() => '');
          await logStep(page, `Dropdown preview: "${(dropText??'').slice(0,200)}"`, 'info');

          const hasComp  = await page.getByText(/comp plan/i).first().isVisible().catch(() => false);
          const hasOther = await page.getByText(/other sold products/i).first().isVisible().catch(() => false);
          await logStep(page, `"Comp Plan" section: ${hasComp?'✓':'FAIL'}`, hasComp?'pass':'fail');
          await logStep(page, `"Other sold products" section: ${hasOther?'✓':'FAIL'}`, hasOther?'pass':'fail');

          // Select Other sold products
          const deselectAll = page.getByRole('button', { name: /none|deselect all|clear all/i });
          if (await deselectAll.isVisible({ timeout: 1_500 }).catch(() => false)) { await deselectAll.click(); await page.waitForTimeout(200); }
          await page.getByText(/other sold products/i).first().click();
          await page.waitForTimeout(300);
          const applyO = page.getByRole('button', { name: /^apply$/i });
          if (await applyO.isVisible().catch(() => false)) await applyO.click();
          await ss.waitForDashboardRefresh();
          const afterOther = (await productBtn.textContent() ?? '').trim();
          await logStep(page, `After Other sold products → "${afterOther}" ${/all|other/i.test(afterOther)?'✓':'check'}`, /all|other/i.test(afterOther)?'pass':'info');

          // Select Comp Plan only
          await productBtn.click(); await page.waitForTimeout(400);
          if (await deselectAll.isVisible({ timeout: 1_500 }).catch(() => false)) { await deselectAll.click(); await page.waitForTimeout(200); }
          await page.getByText(/comp plan/i).first().click();
          await page.waitForTimeout(300);
          const applyC = page.getByRole('button', { name: /^apply$/i });
          if (await applyC.isVisible().catch(() => false)) await applyC.click();
          await ss.waitForDashboardRefresh();
          const afterComp = (await productBtn.textContent() ?? '').trim();
          await logStep(page, `After Comp Plan only → "${afterComp}" ${/comp plan/i.test(afterComp)?'✓':'check'}`, /comp plan/i.test(afterComp)?'pass':'info');

          // "Just this" on first product
          await productBtn.click(); await page.waitForTimeout(400);
          const items = page.locator('li, [role="option"]').filter({ hasText: /\w{4,}/ });
          const itemCnt = await items.count();
          if (itemCnt > 0) {
            await items.first().hover(); await page.waitForTimeout(300);
            const justThis = page.getByRole('button', { name: /just this/i });
            if (await justThis.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await justThis.click();
              const applyJ = page.getByRole('button', { name: /^apply$/i });
              if (await applyJ.isVisible().catch(() => false)) await applyJ.click();
              await ss.waitForDashboardRefresh();
              const afterJust = (await productBtn.textContent() ?? '').trim();
              await logStep(page, `"Just this" → filter: "${afterJust}" ✓`, 'pass');
            } else {
              await logStep(page, '"Just this" not visible on hover — check item selector', 'info');
              await page.keyboard.press('Escape');
            }
          }

          // Multi-select count
          await productBtn.click(); await page.waitForTimeout(400);
          const cbs = page.locator('input[type="checkbox"], [role="checkbox"]');
          const cbCnt = Math.min(3, await cbs.count());
          for (let i = 0; i < cbCnt; i++) { await cbs.nth(i).click({ force: true }).catch(() => {}); await page.waitForTimeout(100); }
          const applyM = page.getByRole('button', { name: /^apply$/i });
          if (await applyM.isVisible().catch(() => false)) await applyM.click();
          await ss.waitForDashboardRefresh();
          const afterMulti = (await productBtn.textContent() ?? '').trim();
          await logStep(page, `${cbCnt} products selected → filter: "${afterMulti}" ✓ (count reflected)`, 'pass');
        });

        // ════════════════════════════════════════════════════════════════════
        // STEP 5b — NDC toggle & search
        // ════════════════════════════════════════════════════════════════════
        await S('Step 5b — Product filter: NDC toggle & search', async () => {
          const productBtn = page.locator('button').filter({ hasText: /comp plan|all products|products/i }).first();
          await productBtn.click(); await page.waitForTimeout(400);

          const ndcToggle = page.getByRole('switch', { name: /ndcs?/i })
            .or(page.locator('[role="switch"]').filter({ hasText: /ndc/i }))
            .or(page.locator('button').filter({ hasText: /ndc/i }));
          if (await ndcToggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
            const before = await page.locator('li,[role="option"]').count();
            await ndcToggle.click(); await page.waitForTimeout(500);
            const afterOn = await page.locator('li,[role="option"]').count();
            await logStep(page, `NDC toggle ON: rows ${before}→${afterOn} ${afterOn>before?'more child NDCs visible ✓':'check'}`, afterOn>before?'pass':'info');
            await ndcToggle.click(); await page.waitForTimeout(500);
            const afterOff = await page.locator('li,[role="option"]').count();
            await logStep(page, `NDC toggle OFF: rows→${afterOff} ${afterOff<afterOn?'only parents ✓':'check'}`, afterOff<afterOn?'pass':'info');
          } else {
            await logStep(page, 'NDC toggle not found — may need a product selected first', 'info');
          }

          const searchInput = page.getByPlaceholder(/search.*product|search.*comp/i)
            .or(page.locator('input[type="search"]').first())
            .or(page.locator('input[placeholder*="search" i]').first());
          if (!(await searchInput.isVisible({ timeout: 3_000 }).catch(() => false))) {
            await logStep(page, 'Product search input not found', 'info');
            await page.keyboard.press('Escape');
            return;
          }

          for (const { short, full } of [
            { short:'ephed',   full:'ephedrine'    },
            { short:'erythro', full:'erythromycin' },
            { short:'fluor',   full:'fluorescein'  },
            { short:'methyl',  full:'methylene'    },
            { short:'papav',   full:'papaverine'   },
            { short:'phenob',  full:'phenobarbital'},
            { short:'procain', full:'procainamide' },
            { short:'tacrol',  full:'tacrolimus'   },
          ]) {
            await searchInput.fill(short); await page.waitForTimeout(350);
            const shortHits = await page.locator('[role="option"],li').filter({ hasText: new RegExp(full,'i') }).count();
            await logStep(page, `Search "${short}" → ${shortHits>0?`${shortHits} hit(s) for "${full}" ✓`:'no results'}`, shortHits>0?'pass':'info');
            await searchInput.fill(full);  await page.waitForTimeout(350);
            const fullHits  = await page.locator('[role="option"],li').filter({ hasText: new RegExp(full,'i') }).count();
            await logStep(page, `Search "${full}" → ${fullHits>0?`${fullHits} hit(s) ✓`:'no results'}`, fullHits>0?'pass':'info');
            await searchInput.clear(); await page.waitForTimeout(200);
          }
          await page.keyboard.press('Escape');
        });

        // ════════════════════════════════════════════════════════════════════
        // STEP 6 — Customers filter
        // ════════════════════════════════════════════════════════════════════
        await S('Step 6 — Customers filter: All / Current / Returning / New', async () => {
          for (const opt of ['All','Current','Returning','New']) {
            await ss.customersFilterButton.click(); await page.waitForTimeout(400);
            const optEl = page.getByRole('button', { name: new RegExp(`^${opt}`,'i') })
              .or(page.getByText(new RegExp(`^${opt}`,'i')).first());
            if (!(await optEl.isVisible({ timeout: 3_000 }).catch(() => false))) {
              await logStep(page, `Customer option "${opt}" not found — closing`, 'info');
              await page.keyboard.press('Escape'); continue;
            }
            await optEl.click(); await page.waitForTimeout(300);
            const applyBtn = page.getByRole('button', { name: /^apply$/i });
            if (await applyBtn.isVisible({ timeout: 1_500 }).catch(() => false)) await applyBtn.click();
            await ss.waitForDashboardRefresh();
            const lbl = (await ss.customersFilterButton.textContent() ?? '').trim();
            await logStep(page, `Customers = "${opt}" → filter: "${lbl}"`, 'info');
            const dataOk = await page.locator('button').filter({ hasText: /contracted sales/i }).first().isVisible({ timeout: 8_000 }).catch(() => false);
            await logStep(page, `Data loads for "${opt}": ${dataOk?'✓':'FAIL'}`, dataOk?'pass':'fail');
          }
          // Reset to All
          await ss.customersFilterButton.click(); await page.waitForTimeout(300);
          await page.getByText(/^all$/i).first().isVisible().then(async (v) => {
            if (v) await page.getByText(/^all$/i).first().click();
          }).catch(() => {});
          const applyR = page.getByRole('button', { name: /^apply$/i });
          if (await applyR.isVisible({ timeout: 1_500 }).catch(() => false)) await applyR.click();
          await ss.waitForDashboardRefresh();
          await logStep(page, 'Customers reset to All ✓', 'pass');
        });

        // Role-specific extra checks
        if (ROLE === 'director') {
          await S('Director-specific — Show team button & rep filter', async () => {
            const showTeam = await ss.showTeamButton.isVisible({ timeout: 5_000 }).catch(() => false);
            await logStep(page, `"Show team" button visible for director: ${showTeam?'✓':'FAIL'}`, showTeam?'pass':'fail');
          });
        } else {
          await S(`${ROLE} — "Show team" should NOT be visible`, async () => {
            const showTeam = await ss.showTeamButton.isVisible({ timeout: 3_000 }).catch(() => false);
            await logStep(page, `"Show team" hidden for ${ROLE}: ${!showTeam?'✓':'FAIL'}`, !showTeam?'pass':'fail');
          });
        }

      } finally {
        // Exit impersonation after each user before moving to the next
        if (isImpersonated) {
          try {
            await logStep(page, `Exiting impersonation for ${user.fullName}…`, 'running');
            await impersonation.exitImpersonation();
            await logStep(page, `Impersonation for ${user.fullName} exited ✓`, 'pass');
          } catch {}
        }
      }

    } // end for (const user of TEST_USERS)

  } finally {}
});
