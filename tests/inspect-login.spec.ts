import { test } from '@playwright/test';

test('inspect post-login + impersonation UI', async ({ page }) => {
  // ── Step 1: Login ──
  await page.goto('https://devapp.paxel.ai/admin/signin', { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Enter your email').fill('tien@paxel.ai');
  await page.getByPlaceholder('Enter your password').fill('Paxel123');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL(url => !url.pathname.includes('/admin/signin'), { timeout: 20_000 });
  await page.waitForLoadState('networkidle');

  console.log('\n=== POST-LOGIN URL ===', page.url());

  // ── Step 2: Impersonate David Farris ──
  await page.getByPlaceholder('Search for User').fill('David');
  await page.waitForTimeout(1000);
  await page.locator('tr').filter({ hasText: 'Nexus Pharmaceuticals' }).filter({ hasText: 'Farris' })
    .getByRole('button', { name: 'Impersonate' }).click();
  await page.waitForSelector('text=Welcome back', { timeout: 20_000 });
  await page.waitForLoadState('networkidle');

  console.log('\n=== URL AFTER IMPERSONATE CLICK ===');
  console.log(page.url());

  console.log('\n=== BUTTONS AFTER IMPERSONATION ===');
  const btns = await page.locator('button').all();
  for (const btn of btns) {
    const text = (await btn.innerText()).trim();
    if (text) console.log(JSON.stringify({ text: text.slice(0, 100), testId: await btn.getAttribute('data-testid') }));
  }

  console.log('\n=== NAV LINKS AFTER IMPERSONATION ===');
  const links = await page.locator('a').all();
  for (const link of links) {
    const text = (await link.innerText()).trim();
    const href = await link.getAttribute('href');
    if (text) console.log(JSON.stringify({ text: text.slice(0, 80), href }));
  }

  // ── Step 3: Open date filter and inspect the open dropdown DOM ──
  const dateBtn = page.locator('button').filter({ hasText: /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d/ });
  await dateBtn.click();
  await page.waitForTimeout(800);

  console.log('\n=== DATE FILTER OPEN — ALL NEW VISIBLE ELEMENTS (non-button) ===');
  const allEls = await page.locator('div, ul, section, aside').all();
  for (const el of allEls) {
    const text = (await el.innerText().catch(() => '')).trim();
    if (text.includes('Yesterday') || text.includes('Month to date') || text.includes('Custom range')) {
      const tag    = await el.evaluate(e => e.tagName);
      const cls    = (await el.getAttribute('class') ?? '').slice(0, 100);
      const role   = await el.getAttribute('role');
      const testId = await el.getAttribute('data-testid');
      console.log(JSON.stringify({ tag, cls, role, testId, textSnippet: text.slice(0, 80) }));
    }
  }

  console.log('\n=== DATE FILTER PRESET ITEMS ===');
  const presetItems = await page.locator('*').filter({ hasText: /^Yesterday$|^Month to date$|^Custom range$/ }).all();
  for (const item of presetItems) {
    const tag    = await item.evaluate(e => e.tagName);
    const cls    = (await item.getAttribute('class') ?? '').slice(0, 100);
    const role   = await item.getAttribute('role');
    console.log(JSON.stringify({ tag, cls, role, text: (await item.innerText()).trim() }));
  }

  // Close date filter
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── Step 4: Open GPO filter and inspect dropdown ──
  await page.getByRole('button', { name: 'All GPOs & Contracts' }).click();
  await page.waitForTimeout(800);

  console.log('\n=== GPO FILTER OPEN — CONTAINER & ITEMS ===');
  const gpoEls = await page.locator('div, ul, section').all();
  for (const el of gpoEls) {
    const text = (await el.innerText().catch(() => '')).trim();
    if (text.length > 5 && text.length < 400 && (text.includes('GPO') || text.includes('Contract') || text.includes('Just this'))) {
      const tag    = await el.evaluate(e => e.tagName);
      const cls    = (await el.getAttribute('class') ?? '').slice(0, 100);
      const role   = await el.getAttribute('role');
      const testId = await el.getAttribute('data-testid');
      console.log(JSON.stringify({ tag, cls, role, testId, textSnippet: text.slice(0, 120) }));
    }
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── Step 5: Click the user avatar (DF) to find exit impersonation option ──
  await page.getByRole('button', { name: 'DF' }).click();
  await page.waitForTimeout(800);

  console.log('\n=== USER AVATAR MENU CONTENT ===');
  const menuEls = await page.locator('*:visible').all();
  for (const el of menuEls) {
    const text = (await el.innerText().catch(() => '')).trim();
    if (text.length > 0 && text.length < 80 &&
       (text.toLowerCase().includes('exit') || text.toLowerCase().includes('admin') ||
        text.toLowerCase().includes('sign out') || text.toLowerCase().includes('logout') ||
        text.toLowerCase().includes('impersonat') || text.toLowerCase().includes('switch') ||
        text.toLowerCase().includes('back'))) {
      const tag    = await el.evaluate(e => e.tagName);
      const cls    = (await el.getAttribute('class') ?? '').slice(0, 100);
      console.log(JSON.stringify({ tag, text, cls }));
    }
  }

  console.log('\n=== ALL VISIBLE SMALL TEXT AFTER AVATAR CLICK ===');
  const allBtnsAfterMenu = await page.locator('button, [role="menuitem"], li, a').all();
  for (const el of allBtnsAfterMenu) {
    const text = (await el.innerText().catch(() => '')).trim();
    if (text && text.length < 60) console.log(JSON.stringify({
      tag:  await el.evaluate(e => e.tagName),
      text,
      role: await el.getAttribute('role'),
    }));
  }
});
