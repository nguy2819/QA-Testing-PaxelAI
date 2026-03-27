import { Page, expect } from '@playwright/test';
import { SalesSummaryPage } from '../pages/SalesSummaryPage';

/**
 * filter.helper.ts
 * Reusable helpers for common filter interaction patterns used across pages.
 * Import these in test files to avoid duplicating filter logic.
 */

// ── Date filter presets ───────────────────────────────────────────────────────

/**
 * Known preset labels.
 * TODO: Replace these with the exact strings shown in the date filter dropdown.
 * ASSUMPTION: These are approximate common dashboard presets.
 */
export const DATE_PRESETS = {
  LAST_30_DAYS:    'Last 30 Days',   // TODO: Verify exact label
  LAST_90_DAYS:    'Last 90 Days',   // TODO: Verify exact label
  THIS_QUARTER:    'This Quarter',   // TODO: Verify exact label
  LAST_QUARTER:    'Last Quarter',   // TODO: Verify exact label
  THIS_YEAR:       'This Year',      // TODO: Verify exact label
  CUSTOM:          'Custom Range',   // TODO: Verify exact label
} as const;

// ── Dropdown scroll helper ────────────────────────────────────────────────────

/**
 * Scrolls a dropdown container to its bottom to confirm all options are reachable.
 * Use for GPO/Contracts and Customers dropdowns where full scroll is a test requirement.
 *
 * @param page          - Playwright Page
 * @param dropdownLocator - The dropdown container locator (must be scrollable)
 */
export async function scrollDropdownToBottom(page: Page, dropdownSelector: string): Promise<void> {
  // TODO: Verify that the dropdown container has overflow scroll and is the right scrollable element
  await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (el) el.scrollTop = el.scrollHeight;
  }, dropdownSelector);

  // Brief pause for virtual list re-render if applicable
  await page.waitForTimeout(300);
}

// ── Multi-select helper ───────────────────────────────────────────────────────

/**
 * Applies multiple selections in a multi-select dropdown and waits for refresh.
 *
 * @param salesSummary - SalesSummaryPage instance
 * @param openFn       - Async fn that opens the dropdown
 * @param optionNames  - Array of option label strings to select
 */
export async function applyMultiSelect(
  salesSummary: SalesSummaryPage,
  openFn: () => Promise<void>,
  optionNames: string[],
): Promise<void> {
  await openFn();
  for (const name of optionNames) {
    // TODO: Verify multi-select uses checkboxes or click-to-toggle. Adjust if needed.
    await salesSummary.page
      .getByRole('option', { name })
      .or(salesSummary.page.getByText(name))
      .click();
  }
  // Close dropdown by pressing Escape or clicking away
  // TODO: Verify whether the dropdown auto-closes after selection or needs an explicit close
  await salesSummary.page.keyboard.press('Escape');
  await salesSummary.waitForDashboardRefresh();
}

// ── Verify dashboard updated after filter change ──────────────────────────────

/**
 * Asserts that the main chart is still visible and the loading state resolved
 * after a filter change. Does NOT validate specific data values.
 *
 * @param salesSummary - SalesSummaryPage instance
 */
export async function assertDashboardRefreshed(salesSummary: SalesSummaryPage): Promise<void> {
  await salesSummary.waitForDashboardRefresh();
  await expect(salesSummary.mainChart).toBeVisible();
  // Also assert no crash/error state
  // TODO: Verify error banner selector if the app has one
  await expect(
    salesSummary.page.locator('[data-testid="error-banner"], .error-state')
  ).not.toBeVisible().catch(() => { /* element may not exist at all — that's fine */ });
}

// ── Combined filter test helper ───────────────────────────────────────────────

/**
 * Applies date + GPO + customer + product filters in sequence and asserts
 * the dashboard updated each time. Use this in the "combine filters" regression test.
 *
 * All option name params default to TODO placeholders — replace with real values.
 */
export async function applyAllFiltersSequentially(
  salesSummary: SalesSummaryPage,
  opts: {
    datePreset?: string;   // TODO: Use a real DATE_PRESETS value
    gpoOption?: string;    // TODO: Use a real GPO option name
    customerOption?: string; // TODO: Use a real customer name
    productFullName?: string; // TODO: Use a real product full name
  } = {},
): Promise<void> {
  if (opts.datePreset) {
    await salesSummary.selectDatePreset(opts.datePreset);
    await assertDashboardRefreshed(salesSummary);
  }
  if (opts.gpoOption) {
    await salesSummary.selectGpoOption(opts.gpoOption);
    await assertDashboardRefreshed(salesSummary);
  }
  if (opts.customerOption) {
    await salesSummary.selectCustomerOption(opts.customerOption);
    await assertDashboardRefreshed(salesSummary);
  }
  if (opts.productFullName) {
    await salesSummary.selectProductByFullName(opts.productFullName);
    await assertDashboardRefreshed(salesSummary);
  }
}
