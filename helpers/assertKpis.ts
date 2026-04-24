import { expect, Page, Response } from '@playwright/test';

function formatNumber(value: number | string) {
  return Number(value).toLocaleString('en-US');
}

function formatCurrency(value: number | string) {
  return `$${Number(value).toLocaleString('en-US')}`;
}

async function findKpiCard(page: Page, title: 'Contracted sales' | 'Units' | 'Orders') {
  const titleNode = page.getByText(new RegExp(`^${title}$`, 'i')).first();

  return page
    .locator('section, div[class*="card"], div[class*="shadow"], div[class*="border"]')
    .filter({ has: titleNode })
    .first();
}

async function expectCardContains(
  page: Page,
  title: 'Contracted sales' | 'Units' | 'Orders',
  expectedCurrent: string,
  expectedPrevious: string
) {
  const card = await findKpiCard(page, title);
  await expect(card).toBeVisible({ timeout: 8000 });

  const text = ((await card.textContent()) ?? '').replace(/\s+/g, ' ').trim();

  expect(
    text.includes(expectedCurrent),
    `${title} card missing current value. Expected to find: ${expectedCurrent}. Actual text: ${text}`
  ).toBeTruthy();

  expect(
    text.includes(expectedPrevious),
    `${title} card missing previous value. Expected to find: ${expectedPrevious}. Actual text: ${text}`
  ).toBeTruthy();
}

export async function waitForSalesComparisonsResponse(page: Page) {
  return page.waitForResponse(
    (res) =>
      res.url().includes('/tenant/sales_comparisons') &&
      res.request().method() === 'POST',
    { timeout: 15000 }
  );
}

export async function assertKpisFromResponse(page: Page, response: Response) {
  const data = await response.json();

  if (data?.message) {
    const bodyText = await page.locator('body').textContent();

    expect(
      bodyText?.includes('--'),
      `Expected no-data KPI UI ("--") when API returned message: ${data.message}`
    ).toBeTruthy();

    return;
  }

  await expectCardContains(
    page,
    'Contracted sales',
    formatCurrency(data.netSales.current),
    formatCurrency(data.netSales.previous)
  );

  await expectCardContains(
    page,
    'Units',
    formatNumber(data.netUnits.current),
    formatNumber(data.netUnits.previous)
  );

  await expectCardContains(
    page,
    'Orders',
    formatNumber(data.netOrders.current),
    formatNumber(data.netOrders.previous)
  );
}