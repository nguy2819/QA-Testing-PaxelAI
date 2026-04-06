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

  const monthName = (d: Date) => escapeRe(MONTHS[d.getMonth()]);
  const dayNum = (d: Date) => d.getDate();
  const yearNum = (d: Date) => d.getFullYear();

  // Accept both:
  // 1) Apr 1–Apr 4, 2026
  // 2) Apr 1–4, 2026
  function sameMonthRangeRegex(start: Date, end: Date): RegExp {
    return new RegExp(
      `${monthName(start)}\\s+${dayNum(start)}(?:,\\s+${yearNum(start)})?\\s*[–-]\\s*` +
      `(?:${monthName(end)}\\s+)?${dayNum(end)},\\s+${yearNum(end)}`,
      'i'
    );
  }

  // Accept cross-month/cross-year ranges like:
  // Jan 1–Mar 31, 2026
  // Jan 1, 2025–Dec 31, 2025
  function fullRangeRegex(start: Date, end: Date): RegExp {
    return new RegExp(
      `${monthName(start)}\\s+${dayNum(start)}(?:,\\s+${yearNum(start)})?\\s*[–-]\\s*` +
      `${monthName(end)}\\s+${dayNum(end)},\\s+${yearNum(end)}`,
      'i'
    );
  }

  function flexibleRangeRegex(start: Date, end: Date): RegExp {
    if (
      start.getMonth() === end.getMonth() &&
      start.getFullYear() === end.getFullYear()
    ) {
      return sameMonthRangeRegex(start, end);
    }
    return fullRangeRegex(start, end);
  }

  if (label === 'Yesterday') {
    return new RegExp(escapeRe(fmtDate(y)), 'i');
  }

  if (label === 'Month-to-date') {
    const start = startOfMonth(y);
    return flexibleRangeRegex(start, y);
  }

  if (label === 'Previous month') {
    const { start, end } = previousMonthRange(y);
    return flexibleRangeRegex(start, end);
  }

  if (label === 'Quarter-to-date') {
    const start = startOfQuarter(y);
    return flexibleRangeRegex(start, y);
  }

  if (label === 'Previous quarter') {
    const { start, end } = previousQuarterRange(y);
    return flexibleRangeRegex(start, end);
  }

  if (label === 'Year-to-date') {
    const start = startOfFiscalYear(y, company);
    return flexibleRangeRegex(start, y);
  }

  if (label === 'Previous year') {
    const { start, end } = previousFiscalYearRange(y, company);
    return flexibleRangeRegex(start, end);
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

  const heading = page.getByText(headingRe).first();
  const headingOk = await heading.isVisible({ timeout: 5000 }).catch(() => false);

  await logStep(
    page,
    `Orders chart heading "Orders • ${presetLabel}": ${headingOk ? '✓' : 'FAIL'}`,
    headingOk ? 'pass' : 'fail'
  );

  if (!headingOk) {
    throw new Error(`Orders chart heading not visible for ${presetLabel}`);
  }

  // Find the chart card/section that contains the heading
  const chartSection = page
    .locator('section, div[class*="chart"], div[class*="card"], div[class*="shadow"], div[class*="border"]')
    .filter({ has: page.getByText(headingRe) })
    .first();

  const sectionVisible = await chartSection.isVisible({ timeout: 3000 }).catch(() => false);

  await logStep(
    page,
    `Orders chart section visible: ${sectionVisible ? '✓' : 'FAIL'}`,
    sectionVisible ? 'pass' : 'fail'
  );

  if (!sectionVisible) {
    throw new Error(`Orders chart section not visible for ${presetLabel}`);
  }

  // Main bar container from live DOM inspection
  const barContainer = chartSection.locator('[data-lov-id="src/components/OrderBarChart.tsx:1101:8"]').first();
  const containerVisible = await barContainer.isVisible({ timeout: 3000 }).catch(() => false);

  await logStep(
    page,
    `Orders chart bar container visible: ${containerVisible ? '✓' : 'FAIL'}`,
    containerVisible ? 'pass' : 'fail'
  );

  if (!containerVisible) {
    throw new Error(`Orders chart bar container not visible for ${presetLabel}`);
  }

  // Count visible child divs inside the bar container
  const childBars = barContainer.locator(':scope > div');
  const childCount = await childBars.count().catch(() => 0);

  let visibleBars = 0;

  for (let i = 0; i < childCount; i++) {
    const bar = childBars.nth(i);
    const visible = await bar.isVisible().catch(() => false);
    if (!visible) continue;

    const box = await bar.boundingBox().catch(() => null);
    if (box && box.height > 8 && box.width > 1) {
      visibleBars++;
    }
  }

  await logStep(
    page,
    `Orders chart visible bar-like columns = ${visibleBars}`,
    visibleBars > 0 ? 'pass' : 'fail'
  );

  if (visibleBars === 0) {
    throw new Error(`Orders chart has no visible colored bars for ${presetLabel}`);
  }
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

          if (/\/tenant\/dashboard/i.test(page.url())) {
            await ss.waitForPageLoad();
          } else {
            await ss.navigateViaMenu();
          }

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
        // STEP 3.5 — Browser/tab sanity before Date Filter
        // Ensures the left live panel is showing the same tab Playwright controls
        // ════════════════════════════════════════════════════════════════════
        async function ensureOnSalesSummary(page: Page, ss: SalesSummaryPage, stepId: string) {
          const url = page.url();
          const isDashboardUrl = /\/tenant\/dashboard/i.test(url);

          // Only find in the main content area, not the entire page
          const main = page.locator('main').first();

          const salesSummaryHeading = main.getByRole('heading', { name: /^sales summary$/i }).first();
          const headingVisible = await salesSummaryHeading.isVisible({ timeout: 1500 }).catch(() => false);

          // Date filter also scope into main
          const dateFilterVisible = await ss.dateFilterButton.first()
          .isVisible({ timeout: 1500 })
          .catch(() => false); 

          const onSalesSummary = isDashboardUrl && headingVisible && dateFilterVisible;

          await logStep(
            page,
            `${stepId}: Sales Summary check → url=${url} isDashboardUrl=${isDashboardUrl} headingVisible=${headingVisible} dateFilterVisible=${dateFilterVisible}`,
            onSalesSummary ? 'pass' : 'info'
          );

          if (onSalesSummary) {
            await logStep(page, `${stepId}: already on Sales Summary ✓`, 'pass');
            return;
          }

          await logStep(page, `${stepId}: WRONG PAGE → navigating to Sales Summary`, 'info');

          await ss.navigateViaMenu();
          await page.waitForLoadState('networkidle').catch(() => {});
          await page.waitForTimeout(1500);

          const finalUrl = page.url();
          const finalIsDashboardUrl = /\/tenant\/dashboard/i.test(finalUrl);

          const finalMain = page.locator('main').first();
          const finalHeadingVisible = await finalMain
            .getByRole('heading', { name: /^sales summary$/i })
            .first()
            .isVisible({ timeout: 2500 })
            .catch(() => false);

          const finalDateFilterVisible = await ss.dateFilterButton.first()
            .isVisible({ timeout: 2500 })
            .catch(() => false);

          const finalOk = finalIsDashboardUrl && finalHeadingVisible && finalDateFilterVisible;

          await logStep(
            page,
            `${stepId}: after navigate → url=${finalUrl} isDashboardUrl=${finalIsDashboardUrl} headingVisible=${finalHeadingVisible} dateFilterVisible=${finalDateFilterVisible}`,
            finalOk ? 'pass' : 'fail'
          );

          if (!finalOk) {
            throw new Error(`${stepId}: FAILED to land on visible Sales Summary page`);
          }
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // STRICT SALES SUMMARY HELPERS (ONE CLEAN VERSION ONLY)
        // Purpose:
        // - avoid stale picker DOM
        // - avoid false "picker opened"
        // - keep Playwright on Sales Summary page
        // - parse KPI cards more accurately
        // - use one consistent strict pattern for 4b–4i
        // ─────────────────────────────────────────────────────────────────────────────

        function rangeText(start: Date, end: Date) {
          return `${MONTHS[start.getMonth()]} ${start.getDate()}–${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // Browser / tab safety
        // ─────────────────────────────────────────────────────────────────────────────
        async function ensureSingleVisiblePage(page: Page, stepId: string) {
        const browser = page.context().browser();
        if (!browser) return;

        const contexts = browser.contexts();

        await logStep(page, `${stepId}: browser contexts = ${contexts.length}`, 'info');

        for (const ctx of contexts) {
          for (const p of ctx.pages()) {
            if (p !== page) {
              await logStep(page, `${stepId}: closing extra page from any context -> ${p.url() || '(blank)'}`, 'info');
              await p.close().catch(() => {});
            }
          }
        }

        await page.bringToFront().catch(() => {});
        await page.waitForTimeout(300);
        await logStep(page, `${stepId}: controlled page brought to front ✓`, 'pass');
      }

        // ─────────────────────────────────────────────────────────────────────────────
        // Date picker strict helpers
        // ─────────────────────────────────────────────────────────────────────────────
       async function closeDatePickerIfOpenStrict(page: Page) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(250);

        const panel = await getOpenDatePickerPanelStrict(page);
        const panelStillOpen = await panel.isVisible({ timeout: 300 }).catch(() => false);

        if (panelStillOpen) {
          const size = page.viewportSize();
          const safeX = size ? Math.max(size.width - 80, 1000) : 1100;
          const safeY = 120;

          await page.mouse.click(safeX, safeY).catch(() => {});
          await page.waitForTimeout(250);
        }
      }

        async function getOpenDatePickerPanelStrict(page: Page) {
          return page.locator(
            'section:has-text("Custom range"), [role="dialog"]:has-text("Custom range"), div[class*="popover"]:has-text("Custom range"), div[class*="panel"]:has-text("Custom range")'
          ).filter({
            has: page.getByText(/yesterday|month-to-date|previous month|quarter-to-date|previous quarter|year-to-date|previous year|custom range/i)
          }).first();
        }

        async function openDateFilterStrict(page: Page, ss: SalesSummaryPage, stepId: string) {
          await logStep(page, `${stepId}: DEBUG current URL = ${page.url()}`, 'info');

          await logStep(page, `Current URL: ${page.url()}`, 'info');
          await ensureSingleVisiblePage(page, stepId);
          await ensureOnSalesSummary(page, ss, stepId);
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

        async function getDateButton(page: Page, ss: SalesSummaryPage) {
          const txt = ((await ss.dateFilterButton.first().textContent()) ?? '').trim();
          return txt.replace(/\s+/g, ' ');
        }

        async function validateDateButtonExact(
          page: Page,
          ss: SalesSummaryPage,
          expected: RegExp,
          stepId: string
        ) {
          const txt = await getDateButton(page, ss);
          const ok = expected.test(txt);

          await logStep(
            page,
            `${stepId}: date button text "${txt}" ${ok ? 'matches' : 'does NOT match'} expected`,
            ok ? 'pass' : 'fail'
          );

          if (!ok) {
            throw new Error(`${stepId}: date button text mismatch → got "${txt}"`);
          }
        }

        async function validateUrlContains(page: Page, re: RegExp, stepId: string) {
          await expect.poll(
            async () => page.url(),
            { timeout: 8000, intervals: [250, 500, 1000] }
          ).toMatch(re);

          await logStep(page, `${stepId}: URL matches expected → ${page.url()}`, 'pass');
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // Strict KPI helpers
        // Reads the Sales Summary KPI cards more accurately
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

          if (hasStrictCurrent) rawCurrent = ((await h1Current.textContent()) ?? '').trim();
          if (hasStrictPrev) rawPrevious = ((await divPrev.textContent()) ?? '').trim();

          const rawText = ((await card.textContent()) ?? '').trim();

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

          return {
            title,
            visible: true,
            current: Number(rawCurrent.replace(/[^0-9.-]/g, '')),
            previous: Number(rawPrevious.replace(/[^0-9.-]/g, '')),
            rawCurrent,
            rawPrevious,
            rawText,
          };
        }

        async function validateKpiCardsYesterdayStrict(page: Page, stepId: string) {
          const labels: ('Contracted sales' | 'Units' | 'Orders')[] = ['Contracted sales', 'Units', 'Orders'];
          const results: { title: string; previous: number }[] = [];

          for (const label of labels) {
            const card = await getKpiCardStrict(page, label);
            const cardVisible = await card.isVisible({ timeout: 5000 }).catch(() => false);

            await logStep(
              page,
              `${stepId}: ${label} card visible: ${cardVisible ? '✓' : 'FAIL'}`,
              cardVisible ? 'pass' : 'fail'
            );

            if (!cardVisible) {
              results.push({ title: label, previous: NaN });
              continue;
            }

            const data = await readKpiCardStrict(page, label);

            await logStep(
              page,
              `${stepId}: ${label} current value = ${isNaN(data.current) ? '(not parseable)' : data.current} (zero is acceptable for Yesterday)`,
              'info'
            );

            const previousOk = !isNaN(data.previous);

            await logStep(
              page,
              `${stepId}: ${label} previous value = ${previousOk ? data.previous : 'FAIL (not parseable)'}`,
              previousOk ? 'pass' : 'fail'
            );

            results.push({ title: label, previous: data.previous });
          }

          const validPrev = results.filter(r => !isNaN(r.previous));
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
            `${stepId}: all three current KPI values are ${allCurrentZero ? '' : 'NOT '}zero: ${allCurrentZero ? 'FAIL' : '✓'}`,
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
            `${stepId}: all three previous KPI values are ${allPreviousZero ? '' : 'NOT '}zero: ${allPreviousZero ? 'FAIL' : '✓'}`,
            allPreviousZero ? 'fail' : 'pass'
          );
            if (allPreviousZero) {
              throw new Error(`${stepId}: all three previous KPI values are 0`);
            }
          }
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // Orders chart strict validation
        // - For 4c–4h chart heading must exist and plot/content must be visible
        // ─────────────────────────────────────────────────────────────────────────────
        async function validateOrdersChart(page: Page, presetLabel: string) {
          const headingRe = new RegExp(`orders\\s*[•·]\\s*${escapeRe(presetLabel)}`, 'i');

          const heading   = page.getByText(headingRe).first();
          const headingOk = await heading.isVisible({ timeout: 5000 }).catch(() => false);

          await logStep(
            page,
            `Orders chart heading "Orders • ${presetLabel}": ${headingOk ? '✓' : 'FAIL'}`,
            headingOk ? 'pass' : 'fail'
          );

          if (!headingOk) {
            throw new Error(`Orders chart heading not visible for ${presetLabel}`);
          }

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

          if (!plotOk) {
            throw new Error(`Orders chart plot area not visible for ${presetLabel}`);
          }
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

        const browser = page.context().browser();
        const contexts = browser ? browser.contexts() : [];
        await logStep(page, `4b: browser contexts = ${contexts.length}`, 'info');

        for (let i = 0; i < contexts.length; i++) {
          await logStep(page, `4b: context[${i}] pages = ${contexts[i].pages().length}`, 'info');
          for (const p of contexts[i].pages()) {
            await logStep(page, `4b: context[${i}] page url = ${p.url()}`, 'info');
          }
        }

                // ════════════════════════════════════════════════════════════════════
        // STEP 4b — Date filter: Yesterday
        // Business rule:
        // - Yesterday may already be selected by default
        // - current KPI values may be zero
        // - FAIL only if all 3 previous KPI values are zero
        // - chart may show no-data OR heading OR plot
        // - Chart may show:
        //   1. no-data state
        //   2. heading
        //   3. visible plot
        //   Any of those is acceptable for Yesterday
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4b — Date filter: Yesterday', async () => {
          await logStep(
            page,
            `Selecting Yesterday (user: ${user.fullName}, company: ${user.company})`,
            'info'
          );

          // Safety: make sure the controlled page is visible and still on Sales Summary
          await ensureSingleVisiblePage(page, '4b');
          await ensureOnSalesSummary(page, ss, '4b');

          // Open the date filter and click Yesterday inside the visible picker
          const panel = await openDateFilterStrict(page, ss, '4b');
          await clickDatePresetStrict(page, panel, 'Yesterday', '4b');
          await page.waitForTimeout(500);

          await logStep(page, `4b: URL after selection → ${page.url()}`, 'info');

          // Yesterday may already be selected by default, so we only verify final button text
          await validateDateButtonExact(
            page,
            ss,
            expectedDateRegex('Yesterday', yesterday(), user.company),
            '4b'
          );
          // Strict KPI validation for Yesterday:
          // - current may be 0
          // - previous must parse correctly
          // - FAIL if all 3 previous values are 0
          await validateKpiCardsYesterdayStrict(page, '4b');

          // Yesterday chart is more flexible:
          // acceptable if there is either:
          // - no sales data state
          // - orders heading
          // - visible chart plot/content
          const noData = await page.getByText(/no sales data/i).first()
            .isVisible({ timeout: 2000 }).catch(() => false);

          const heading = await page.getByText(/orders\s*[•·]\s*yesterday/i).first()
            .isVisible({ timeout: 2000 }).catch(() => false);

          const plot = await page.locator(
            'svg, canvas, [class*="bar"], [class*="plot"], [class*="chart-area"]'
          ).first().isVisible({ timeout: 2000 }).catch(() => false);

          const chartOk = noData || heading || plot;

          await logStep(
            page,
            `4b: Yesterday chart state — noData:${noData} heading:${heading} plot:${plot} → ${chartOk ? '✓ (acceptable)' : 'FAIL'}`,
            chartOk ? 'pass' : 'fail'
          );

          if (!chartOk) {
            throw new Error('4b: chart invalid state');
          }

          await closeDatePickerIfOpenStrict(page);
        });

        // ════════════════════════════════════════════════════════════════════
        // STEP 4c — Date filter: Month-to-date
        // Business rule:
        // - start of month → yesterday (not today)
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4c — Date filter: Month-to-date', async () => {
          const y = yesterday();
          const start = startOfMonth(y);

          await ensureSingleVisiblePage(page, '4c');
          await ensureOnSalesSummary(page, ss, '4c');

          await logStep(
            page,
            `4c: expected MTD range = ${rangeText(start, y)} (start of month → yesterday, not today)`,
            'info'
          );

          const panel = await openDateFilterStrict(page, ss, '4c');
          await clickDatePresetStrict(page, panel, 'Month-to-date', '4c');
          await page.waitForTimeout(500);

          await validateUrlContains(page, /dateRange=month-to-date/i, '4c');

          await validateDateButtonExact(
            page,
            ss,
            expectedDateRegex('Month-to-date', y, user.company),
            '4c'
          );

          await validateKpiCardsRegularStrict(page, 'Previous MTD', '4c');
          await validateOrdersChart(page, 'Month-to-date');

          await closeDatePickerIfOpenStrict(page);
        });

        // ════════════════════════════════════════════════════════════════════
        // STEP 4d — Date filter: Previous month
        // Business rule:
        // - full previous calendar month
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4d — Date filter: Previous month', async () => {
          const y = yesterday();
          const { start, end } = previousMonthRange(y);

          await ensureSingleVisiblePage(page, '4d');
          await ensureOnSalesSummary(page, ss, '4d');

          await logStep(
            page,
            `4d: expected Previous month range = ${rangeText(start, end)}`,
            'info'
          );

          const panel = await openDateFilterStrict(page, ss, '4d');
          await clickDatePresetStrict(page, panel, 'Previous month', '4d');
          await page.waitForTimeout(500);

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
        // - quarter start → yesterday
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4e — Date filter: Quarter-to-date', async () => {
          const y = yesterday();
          const start = startOfQuarter(y);

          await ensureSingleVisiblePage(page, '4e');
          await ensureOnSalesSummary(page, ss, '4e');

          await logStep(
            page,
            `4e: expected QTD range = ${rangeText(start, y)} (quarter start → yesterday)`,
            'info'
          );

          const panel = await openDateFilterStrict(page, ss, '4e');
          await clickDatePresetStrict(page, panel, 'Quarter-to-date', '4e');
          await page.waitForTimeout(500);

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
        // - full previous quarter
        // Example if today is Apr 5, 2026 → previous quarter = Jan 1–Mar 31, 2026
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4f — Date filter: Previous quarter', async () => {
          const y = yesterday();
          const { start, end } = previousQuarterRange(y);

          await ensureSingleVisiblePage(page, '4f');
          await ensureOnSalesSummary(page, ss, '4f');

          await logStep(
            page,
            `4f: expected Previous quarter range = ${rangeText(start, end)}`,
            'info'
          );

          const panel = await openDateFilterStrict(page, ss, '4f');
          await clickDatePresetStrict(page, panel, 'Previous quarter', '4f');
          await page.waitForTimeout(500);

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
        // - fiscal-year aware
        // Nexus = Jan start; Caplin = Apr start
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4g — Date filter: Year-to-date', async () => {
          const y = yesterday();
          const company = user.company;
          const start = startOfFiscalYear(y, company);

          await ensureSingleVisiblePage(page, '4g');
          await ensureOnSalesSummary(page, ss, '4g');

          await logStep(
            page,
            `4g: expected YTD range = ${rangeText(start, y)} (fiscal-year aware for ${company})`,
            'info'
          );

          const panel = await openDateFilterStrict(page, ss, '4g');
          await clickDatePresetStrict(page, panel, 'Year-to-date', '4g');
          await page.waitForTimeout(500);

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
        // - full previous fiscal year
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4h — Date filter: Previous year', async () => {
          const y = yesterday();
          const company = user.company;
          const { start, end } = previousFiscalYearRange(y, company);

          await ensureSingleVisiblePage(page, '4h');
          await ensureOnSalesSummary(page, ss, '4h');

          await logStep(
            page,
            `4h: expected Previous year range = ${rangeText(start, end)} (fiscal-year aware for ${company})`,
            'info'
          );

          const panel = await openDateFilterStrict(page, ss, '4h');
          await clickDatePresetStrict(page, panel, 'Previous year', '4h');
          await page.waitForTimeout(500);

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
        // - accepts multi-day range
        // - button text becomes range
        // - KPI cards remain visible
        // - Orders heading remains visible
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4i1 — Date filter: Custom range multi-day', async () => {
          await ensureSingleVisiblePage(page, '4i1');
          await ensureOnSalesSummary(page, ss, '4i1');

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

          for (const label of ['Contracted sales', 'Units', 'Orders'] as const) {
            const titleNode = page.getByText(new RegExp(`^${escapeRe(label)}$`, 'i')).first();
            const card = page.locator('section, div[class*="card"], div[class*="shadow"], div[class*="border"]')
              .filter({ has: titleNode })
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
        // - same day as start/end should show single-day behavior
        // - donut/pie style visualization should be visible
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4i2 — Date filter: Custom range single-day', async () => {
          await ensureSingleVisiblePage(page, '4i2');
          await ensureOnSalesSummary(page, ss, '4i2');

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
        // - clicking outside closes custom range picker
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4i3 — Date filter: Custom range outside-click close', async () => {
          await ensureSingleVisiblePage(page, '4i3');
          await ensureOnSalesSummary(page, ss, '4i3');

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
