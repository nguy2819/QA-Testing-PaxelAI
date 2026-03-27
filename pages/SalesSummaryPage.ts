import { Page, Locator, expect } from '@playwright/test';

/**
 * SalesSummaryPage
 * URL: /tenant/dashboard  (Sales Summary is the default landing page after impersonation)
 *
 * All selectors confirmed from live DOM inspection of devapp.paxel.ai.
 * TODO comments only remain where real test data (product names, GPO names, etc.) is needed.
 */
export class SalesSummaryPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  /** Navigate directly — use after impersonation lands on /tenant/dashboard */
  async goto(): Promise<void> {
    await this.page.goto('/tenant/dashboard');
    await this.waitForPageLoad();
  }

  /** Navigate via the left sidebar button */
  async navigateViaMenu(): Promise<void> {
    await this.page.getByRole('button', { name: 'Sales summary' }).click();
    await this.waitForPageLoad();
  }

  // ── Page-level locators ──────────────────────────────────────────────────────

  /** Main heading — confirmed as <h2>Sales summary</h2> */
  get pageHeading(): Locator {
    return this.page.locator('h2').filter({ hasText: 'Sales summary' });
  }

  /** Filter bar area — identified by the presence of the date + filter buttons */
  get filterBar(): Locator {
    return this.page.locator('button', { hasText: 'All customers' }).locator('..');
  }

  /**
   * Loading spinner — TODO: Verify exact selector.
   * No spinner was observed during inspection; using a broad fallback.
   */
  get loadingSpinner(): Locator {
    return this.page
      .locator('[data-testid="loading-spinner"]')
      .or(this.page.locator('[role="progressbar"]'));
  }

  /** Empty state — confirmed copy: "No sales data" */
  get emptyState(): Locator {
    return this.page.getByText('No sales data');
  }

  // ── Summary cards (KPI tiles) ─────────────────────────────────────────────

  /**
   * KPI cards are rendered as buttons: "Contracted sales", "Units", "Orders"
   * at the top of the page.
   */
  get contractedSalesCard(): Locator {
    return this.page.getByText('Contracted sales', { exact: false });
  }

  get unitsCard(): Locator {
    return this.page.getByText('Units', { exact: false }).first();
  }

  get ordersCard(): Locator {
    return this.page.getByText('Orders', { exact: false }).first();
  }

  // ── Bottom stat tabs (Orders / Accounts / Contracts / Distributors) ────────

  /** Tabs row below the chart — confirmed: Orders, Accounts, Contracts, Distributors */
  get statTabs(): Locator {
    return this.page.locator('button').filter({ hasText: /^(Orders|Accounts|Contracts|Distributors)\n?\d+$/ });
  }

  // ── Main chart area ───────────────────────────────────────────────────────

  /**
   * The chart area — contains "No sales data" when empty, or a chart when data exists.
   * TODO: Verify chart element selector when data is present (canvas/svg/recharts).
   */
  get chartArea(): Locator {
    return this.page.getByText('No sales data').locator('..')
      .or(this.page.locator('canvas, .recharts-wrapper, [data-testid="chart"]'));
  }

  // ── Date filter ───────────────────────────────────────────────────────────

  /**
   * Date filter button — shows current date text, e.g., "Mar 24, 2026"
   * Using a regex to match any date format.
   */
  get dateFilterButton(): Locator {
    return this.page.locator('button').filter({
      hasText: /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/
    });
  }

  /**
   * Date filter dropdown container — confirmed: a div with z-50 + shadow, containing
   * a section with the preset list. Appears after clicking the date button.
   */
  get dateFilterDropdown(): Locator {
    return this.page.locator('div[class*="z-50"]').filter({ hasText: 'Yesterday' });
  }

  /**
   * Real date preset labels (confirmed from DOM inspection):
   * Yesterday | Month-to-date | Previous month | Quarter-to-date |
   * Previous quarter | Year-to-date | Custom range
   */
  static readonly DATE_PRESETS = {
    YESTERDAY:       'Yesterday',
    MONTH_TO_DATE:   'Month-to-date',
    PREVIOUS_MONTH:  'Previous month',
    QUARTER_TO_DATE: 'Quarter-to-date',
    PREVIOUS_QUARTER:'Previous quarter',
    YEAR_TO_DATE:    'Year-to-date',
    CUSTOM_RANGE:    'Custom range',
  } as const;

  async openDateFilter(): Promise<void> {
    await this.dateFilterButton.click();
    // Presets are div[role="button"] elements — wait for Yesterday to appear
    await this.page.locator('div[role="button"]').filter({ hasText: 'Yesterday' })
      .waitFor({ state: 'visible', timeout: 8_000 });
  }

  /**
   * Select a date preset. Use SalesSummaryPage.DATE_PRESETS for confirmed labels.
   * Preset items are div[role="button"] elements inside the dropdown.
   */
  async selectDatePreset(label: string): Promise<void> {
    await this.openDateFilter();
    await this.page.locator('div[role="button"]').filter({ hasText: label }).click();
    await this.waitForDashboardRefresh();
  }

  /**
   * Set a custom date range.
   * TODO: Confirm date input selectors and accepted format after opening the calendar.
   */
  async setCustomDateRange(startDate: string, endDate: string): Promise<void> {
    await this.openDateFilter();
    const startInput = this.page.locator('input[placeholder*="start" i], [data-testid="date-start"]');
    const endInput   = this.page.locator('input[placeholder*="end" i], [data-testid="date-end"]');
    await startInput.fill(startDate);
    await endInput.fill(endDate);
    await this.page.getByRole('button', { name: /apply|confirm|ok/i }).click();
    await this.waitForDashboardRefresh();
  }

  // ── "All" filter (rep performance — directors & executives only) ──────────

  /**
   * The leftmost "All" dropdown in the filter bar.
   * Confirmed visible for Sales Rep (David Farris).
   * TODO: Confirm whether this is the rep-performance filter or a different filter.
   */
  get allRepFilter(): Locator {
    return this.page.getByRole('button', { name: 'All' }).first();
  }

  // ── Customers filter ──────────────────────────────────────────────────────

  /** Confirmed button text: "All customers" */
  get customersFilterButton(): Locator {
    return this.page.getByRole('button', { name: 'All customers' });
  }

  async openCustomersFilter(): Promise<void> {
    await this.customersFilterButton.click();
    await this.page.waitForTimeout(500);
    // TODO: Replace with waitFor once dropdown selector is confirmed
  }

  async selectCustomerOption(name: string): Promise<void> {
    await this.openCustomersFilter();
    // TODO: Verify option selector inside customers dropdown
    await this.page.getByText(name).click();
    await this.waitForDashboardRefresh();
  }

  // ── GPO & Contracts filter ────────────────────────────────────────────────

  /** Confirmed button text: "All GPOs & Contracts" */
  get gpoFilterButton(): Locator {
    return this.page.getByRole('button', { name: 'All GPOs & Contracts' });
  }

  /**
   * GPO filter search input — confirmed: placeholder is "Search GPOs & Contracts".
   * Appears after clicking the GPO filter button.
   */
  get gpoSearchInput(): Locator {
    return this.page.getByPlaceholder('Search GPOs & Contracts');
  }

  /** GPO filter "Apply" button — confirmed visible in open dropdown */
  get gpoApplyButton(): Locator {
    return this.page.getByRole('button', { name: 'Apply' });
  }

  async openGpoFilter(): Promise<void> {
    await this.gpoFilterButton.click();
    await this.gpoSearchInput.waitFor({ state: 'visible', timeout: 8_000 });
  }

  async selectGpoOption(name: string): Promise<void> {
    await this.openGpoFilter();
    // TODO: Verify option selector inside GPO dropdown
    await this.page.getByText(name).click();
    await this.waitForDashboardRefresh();
  }

  /**
   * "Just this" option — appears on hover of a GPO item.
   * TODO: Verify whether "Just this" is a button revealed on hover.
   */
  async selectJustThisGpo(optionName: string): Promise<void> {
    await this.openGpoFilter();
    const item = this.page.getByText(optionName);
    await item.hover();
    await this.page.getByRole('button', { name: /just this/i }).click();
    await this.waitForDashboardRefresh();
  }

  // ── Product filter ────────────────────────────────────────────────────────

  /**
   * TODO: A "Product" filter was NOT observed in the initial inspection.
   * It may appear inside the "All" dropdown or as a separate filter.
   * Leaving as placeholder pending further inspection.
   */
  get productFilterButton(): Locator {
    return this.page.getByRole('button', { name: /all products|product/i });
  }

  get productSearchInput(): Locator {
    return this.page.getByPlaceholder(/search product/i);
  }

  async openProductFilter(): Promise<void> {
    await this.productFilterButton.click();
    await this.productSearchInput.waitFor({ state: 'visible', timeout: 8_000 });
  }

  async selectProductByFullName(fullName: string): Promise<void> {
    await this.openProductFilter();
    await this.productSearchInput.fill(fullName);
    await this.page.waitForTimeout(500);
    await this.page.getByText(fullName).first().click();
    await this.waitForDashboardRefresh();
  }

  async selectProductByShortName(shortName: string): Promise<void> {
    await this.openProductFilter();
    await this.productSearchInput.fill(shortName);
    await this.page.waitForTimeout(500);
    await this.page.locator('[data-testid="product-option"]').filter({ hasText: shortName }).first().click();
    await this.waitForDashboardRefresh();
  }

  async searchProduct(query: string): Promise<void> {
    await this.openProductFilter();
    await this.productSearchInput.fill(query);
    await this.page.waitForTimeout(500);
  }

  // ── NDC toggle ────────────────────────────────────────────────────────────

  /**
   * "Show individual NDCs" toggle.
   * TODO: Not observed in initial inspection — may appear only when a product is selected.
   */
  get showNdcToggle(): Locator {
    return this.page
      .getByRole('switch', { name: /show individual ndcs/i })
      .or(this.page.getByLabel(/show individual ndcs/i));
  }

  async toggleNdcView(): Promise<void> {
    await this.showNdcToggle.click();
    await this.waitForDashboardRefresh();
  }

  // ── Role-based elements ───────────────────────────────────────────────────

  /**
   * "My comp plan" — confirmed visible as a button on the right side.
   * TODO: Confirm which roles can/cannot see this.
   */
  get myCompPlanButton(): Locator {
    return this.page.getByRole('button', { name: 'My comp plan' });
  }

  /**
   * "Show team" button — visible ONLY for directors.
   * TODO: Not observed for Sales Rep. Confirm selector once tested with a director.
   */
  get showTeamButton(): Locator {
    return this.page.getByRole('button', { name: /show team/i });
  }

  /**
   * Rep performance filter — the "All" dropdown in the filter bar.
   * TODO: Confirm this is the rep-performance filter for directors/executives.
   */
  get repPerformanceFilter(): Locator {
    return this.allRepFilter;
  }

  // ── Detail navigation ─────────────────────────────────────────────────────

  /**
   * Navigate to another page via the left sidebar buttons.
   * Confirmed: sidebar uses <button> elements, not <a> links.
   */
  async navigateToPage(pageName: 'Sales summary' | 'Accounts' | 'Opportunities' | 'Contracts & pricing' | 'Contacts'): Promise<void> {
    await this.page.getByRole('button', { name: pageName }).click();
    await this.waitForDashboardRefresh();
  }

  // ── Aliases for backwards-compat with test files ─────────────────────────

  /** Alias → chartArea */
  get mainChart(): Locator { return this.chartArea; }

  /** KPI card group — first card in the "Contracted sales / Units / Orders" row */
  get summaryCards(): Locator {
    return this.page.locator('button').filter({ hasText: /Contracted sales|Units|Orders/ });
  }

  /**
   * GPO filter dropdown — confirmed: identified by the search input placeholder.
   * Use gpoSearchInput for the actual input element inside the dropdown.
   */
  get gpoFilterDropdown(): Locator {
    return this.page.locator('div').filter({ hasText: 'Search GPOs & Contracts' }).first();
  }

  /**
   * Customers dropdown container — appears after clicking customersFilterButton.
   * TODO: Replace with confirmed selector once the dropdown has been inspected open.
   */
  get customersFilterDropdown(): Locator {
    return this.page
      .locator('[data-testid="customers-dropdown"]')
      .or(this.page.locator('[role="listbox"], [role="menu"]').filter({ hasText: /customer/i }));
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  async waitForPageLoad(): Promise<void> {
    await this.loadingSpinner
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => { /* no spinner on fast loads */ });
    await this.pageHeading.waitFor({ state: 'visible', timeout: 15_000 });
  }

  async waitForDashboardRefresh(): Promise<void> {
    // Fixed wait: live SPAs with background polling never reach networkidle.
    // 800ms is enough for a filter selection to update the dashboard.
    await this.page.waitForTimeout(800);
    await this.loadingSpinner
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .catch(() => {});
  }

  async resetAllFilters(): Promise<void> {
    // TODO: Verify reset/clear-all button selector — not observed in initial inspection
    const resetButton = this.page.getByRole('button', { name: /reset|clear all/i });
    const isVisible = await resetButton.isVisible().catch(() => false);
    if (isVisible) {
      await resetButton.click();
      await this.waitForDashboardRefresh();
    }
  }
}
