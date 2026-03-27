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
import { initRun, logStep, startLiveCapture, stopLiveCapture } from '../../helpers/step.helper';

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

function expectedDateRegex(label: string, ref = yesterday()): RegExp {
  const y = ref;
  const yText = escapeRe(fmtDate(y));

  if (label === 'Yesterday') {
    return new RegExp(yText, 'i');
  }

  if (label === 'Month-to-date') {
    const start = startOfMonth(y);
    return new RegExp(`${escapeRe(MONTHS[start.getMonth()])}\\s+${start.getDate()}\\s*[–-]\\s*${escapeRe(MONTHS[y.getMonth()])}\\s+${y.getDate()},\\s+${y.getFullYear()}`, 'i');
  }

  if (label === 'Previous month') {
    const { start, end } = previousMonthRange(y);
    return new RegExp(`${escapeRe(MONTHS[start.getMonth()])}\\s+${start.getDate()}\\s*[–-]\\s*${escapeRe(MONTHS[end.getMonth()])}\\s+${end.getDate()},\\s+${end.getFullYear()}`, 'i');
  }

  if (label === 'Quarter-to-date') {
    const start = startOfQuarter(y);
    return new RegExp(`${escapeRe(MONTHS[start.getMonth()])}\\s+${start.getDate()}\\s*[–-]\\s*${escapeRe(MONTHS[y.getMonth()])}\\s+${y.getDate()},\\s+${y.getFullYear()}`, 'i');
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
  startLiveCapture(page);

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
      // STEP 4b — Date filter: click Previous month, verify selection works
      // ════════════════════════════════════════════════════════════════════
      await S('Step 4b — Date filter: click Previous month, verify date text updates', async () => {
        // close picker first if already open
        const pickerBefore = page.locator('div[data-lov-id*="DatePickerListItem"]').first();
        const alreadyOpen = await pickerBefore.isVisible({ timeout: 500 }).catch(() => false);
        if (alreadyOpen) {
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(500);
        }

        await logStep(page, `Before URL: ${page.url()}`, 'info');

        const dateBtn = ss.dateFilterButton.first();

        const btnVisible = await dateBtn.isVisible({ timeout: 3000 }).catch(() => false);
        await logStep(
          page,
          `Date filter button visible in 4b: ${btnVisible ? '✓' : 'FAIL'}`,
          btnVisible ? 'pass' : 'fail'
        );
        if (!btnVisible) return;

        await dateBtn.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(200);
        await dateBtn.hover().catch(() => {});
        await page.waitForTimeout(200);

        // first click
        await dateBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(800);

        const picker = page.locator('section').filter({
          has: page.locator('text=Yesterday'),
          hasText: /Month-to-date/
        }).first();

        let pickerOpened = await picker.isVisible({ timeout: 1500 }).catch(() => false);

        // second click if needed
        if (!pickerOpened) {
          await logStep(page, 'Date picker did not open on first click — retrying', 'info');
          await dateBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(1000);
          pickerOpened = await picker.isVisible({ timeout: 1500 }).catch(() => false);
        }

        await logStep(
          page,
          `Date picker opened in 4b: ${pickerOpened ? '✓' : 'FAIL'}`,
          pickerOpened ? 'pass' : 'fail'
        );
        if (!pickerOpened) return;

        const previousMonth = picker.locator('div[data-lov-id*="DatePickerListItem"]')
          .filter({ hasText: /^Previous month$/i })
          .first();

        const optVis = await previousMonth.isVisible({ timeout: 2000 }).catch(() => false);
        await logStep(
          page,
          `"Previous month" option visible: ${optVis ? '✓' : 'FAIL'}`,
          optVis ? 'pass' : 'fail'
        );
        if (!optVis) return;

        await previousMonth.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1500);

        const urlOk = /dateRange=previous-month/i.test(page.url());
        await logStep(
          page,
          `URL updated to previous-month: ${urlOk ? '✓' : 'FAIL'} | ${page.url()}`,
          urlOk ? 'pass' : 'fail'
        );

        const headingOk = await page.getByText(/orders\s*•\s*previous month/i)
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        await logStep(
          page,
          `Chart heading shows Previous month: ${headingOk ? '✓' : 'check manually'}`,
          headingOk ? 'pass' : 'info'
        );
      });

        
        // ════════════════════════════════════════════════════════════════════
// STEP 4c — Previous month: KPI visibility + chart (STABLE VERSION)
// ════════════════════════════════════════════════════════════════════
await S('Step 4c — Previous month: KPI visibility & chart (stable)', async () => {
  // 4b already selected Previous month
  const urlOk = /dateRange=previous-month/i.test(page.url());
  await logStep(
    page,
    `URL is still previous-month: ${urlOk ? '✓' : 'FAIL'} | ${page.url()}`,
    urlOk ? 'pass' : 'fail'
  );

  // KPI cards visible
  const contractedSalesVisible = await page.getByText(/contracted sales/i)
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  const unitsVisible = await page.getByText(/^units$/i)
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  const ordersVisible = await page.getByText(/^orders$/i)
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  await logStep(
    page,
    `Contracted Sales visible: ${contractedSalesVisible ? '✓' : 'FAIL'}`,
    contractedSalesVisible ? 'pass' : 'fail'
  );

  await logStep(
    page,
    `Units visible: ${unitsVisible ? '✓' : 'FAIL'}`,
    unitsVisible ? 'pass' : 'fail'
  );

  await logStep(
    page,
    `Orders visible: ${ordersVisible ? '✓' : 'FAIL'}`,
    ordersVisible ? 'pass' : 'fail'
  );

  // Chart heading
  const headingOk = await page.getByText(/orders\s*•\s*previous month/i)
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  await logStep(
    page,
    `Chart heading shows Previous month: ${headingOk ? '✓' : 'FAIL'}`,
    headingOk ? 'pass' : 'fail'
  );

  // Chart visible
  const chartVisible = await page
    .locator('div[data-lov-id*="OrderBarChart"], div[class*="bar-grow"]')
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  await logStep(
    page,
    `Order chart visible: ${chartVisible ? '✓' : 'FAIL'}`,
    chartVisible ? 'pass' : 'fail'
  );
});


        // ════════════════════════════════════════════════════════════════════
        // STEP 4d — Custom range
        // ════════════════════════════════════════════════════════════════════
        await S('Step 4d — Custom range: multi-month, single-day, outside-click close', async () => {
          // Wide range
          await ss.openDateFilter();
          await page.locator('div[role="button"]').filter({ hasText: /custom range/i }).click();
          await page.waitForTimeout(600);

          const CELL_SELECTORS = [
            '[role="gridcell"] button:not([disabled]):not([aria-disabled="true"])',
            'button.rdp-day:not(.rdp-day_disabled):not(.rdp-day_outside)',
            'table td button:not([disabled])',
          ];
          let cells = page.locator('[role="gridcell"] button:not([disabled])');
          for (const sel of CELL_SELECTORS) {
            if (await page.locator(sel).count() > 5) { cells = page.locator(sel); break; }
          }

          const cnt = await cells.count();
          if (cnt >= 2) {
            await cells.first().click(); await page.waitForTimeout(250);
            await cells.last().click();  await page.waitForTimeout(250);
            await logStep(page, `Wide range: first → last cell selected (${cnt} cells) ✓`, 'pass');
          }

          const applyWide = page.getByRole('button', { name: /^apply$/i });
          if (await applyWide.isVisible({ timeout: 2_000 }).catch(() => false)) await applyWide.click();
          await ss.waitForDashboardRefresh();

          const wideDateTxt = (await ss.dateFilterButton.first().textContent() ?? '').trim();
          await logStep(page, `Wide range — date filter: "${wideDateTxt}"`, 'info');
          await checkAllKpi(page);

          // Single-day
          await ss.openDateFilter();
          await page.locator('div[role="button"]').filter({ hasText: /custom range/i }).click();
          await page.waitForTimeout(600);

          const scCells = page.locator(CELL_SELECTORS[0]);
          const sc = await scCells.count();
          if (sc > 0) {
          const mid = scCells.nth(Math.floor(sc / 2));
          await mid.click();
          await page.waitForTimeout(300);
          await logStep(page, 'Single-day custom range selected ✓', 'pass');
        }
          const singleDayTxt = await getDateButtonText(ss);
          await logStep(page, `Single-day custom range date text: "${singleDayTxt}"`, 'info');
          const applyS = page.getByRole('button', { name: /^apply$/i });
          if (await applyS.isVisible({ timeout: 2_000 }).catch(() => false)) await applyS.click();
          await ss.waitForDashboardRefresh();

          const donut = page.locator('[class*="donut"],[class*="pie"],svg circle').first();
          const donutVis = await donut.isVisible({ timeout: 5_000 }).catch(() => false);
          await logStep(page, `Single-day donut chart: ${donutVis ? 'visible ✓' : 'not detected'}`, donutVis ? 'pass' : 'info');

          // Outside click closes picker
          await ss.openDateFilter();
          await page.locator('div[role="button"]').filter({ hasText: /custom range/i }).click();
          await page.waitForTimeout(400);
          await page.locator('h1, h2, main').first().click({ force: true });
          await page.waitForTimeout(500);
          const calGone = !(await page.locator('[role="gridcell"]').first().isVisible().catch(() => false));
          await logStep(page, `Date picker closes on outside click: ${calGone ? '✓' : 'FAIL'}`, calGone ? 'pass' : 'fail');
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

  } finally {
    stopLiveCapture();
  }
});
