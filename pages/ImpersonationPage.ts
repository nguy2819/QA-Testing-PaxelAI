import { Page, Locator, expect } from '@playwright/test';
import { PaxelUser } from '../data/users';

/**
 * ImpersonationPage
 *
 * Manages the full impersonation lifecycle:
 *   search → select exact row → click Impersonate → verify context → exit
 *
 * How it works (confirmed from DOM inspection):
 *   - Admin dashboard has a "Search for User" input that filters a results table
 *   - Each table row has an "Impersonate" button
 *   - Clicking "Impersonate" navigates to /tenant/dashboard as that user
 *   - Exit: navigate back to /admin/dashboard, which clears impersonation state
 *
 * Rules enforced (from QA execution order spec):
 *   - Rule #4:  Search by first name only
 *   - Rule #6:  Select exact full-name + correct company row
 *   - Rule #8:  Verify visible user context after impersonation
 *   - Rule #11: Exit/reset impersonation state
 *   - Rule #12: Confirm previous context is gone
 */
export class ImpersonationPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Locators ────────────────────────────────────────────────────────────────

  /** Text input that filters the user results table on /admin/dashboard */
  get searchInput(): Locator {
    return this.page.getByPlaceholder('Search for User');
  }

  /**
   * "Welcome back [FirstName]!" greeting shown at the top of the tenant app.
   * This is the confirmed context indicator after impersonation.
   */
  get welcomeGreeting(): Locator {
    return this.page.getByText('Welcome back', { exact: false });
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  /**
   * Rules #3 + #4: Clear previous search, type first name only.
   */
  async clearAndSearch(firstName: string): Promise<void> {
    await this.searchInput.clear();
    await this.searchInput.fill(firstName);
    // Wait for table to re-render with filtered results
    await this.page.waitForTimeout(800);
  }

  /**
   * Rule #6: Find the exact row matching full name + company, then click Impersonate.
   * Uses last name (split across TD) + company name to disambiguate.
   */
  async selectExactUser(user: PaxelUser): Promise<void> {
    // Each row has: Tenant Name | First Name | Last Name | Email | Role | Status | Impersonate
    const lastName = user.fullName.split(' ').pop()!;
    const targetRow = this.page.locator('tr')
      .filter({ hasText: user.company })
      .filter({ hasText: lastName });

    await expect(targetRow).toBeVisible({ timeout: 10_000 });
    await targetRow.getByRole('button', { name: 'Impersonate' }).click();
  }

  /**
   * Rule #8: Verify the tenant app loaded and shows the correct user context.
   * After impersonation the page navigates to /tenant/dashboard and shows
   * "Welcome back [FirstName]!"
   */
  async verifyUserContext(user: PaxelUser): Promise<void> {
    // Wait for the tenant app URL
    await this.page.waitForURL('**/tenant/dashboard', { timeout: 20_000 });
    // Confirm the greeting contains the user's first name
    await expect(
      this.page.getByText(user.firstName, { exact: false })
    ).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Full impersonation flow for a single user (Rules #2 → #8).
   * Starts from /admin/dashboard. Call loginAsAdmin() before this.
   */
  async impersonateUser(user: PaxelUser): Promise<void> {
    // Ensure we're on the admin dashboard before searching
    if (!this.page.url().includes('/admin/dashboard')) {
      await this.page.goto('/admin/dashboard');
      await this.page.waitForTimeout(1_500); // networkidle never fires on polling dashboards
    }

    await this.clearAndSearch(user.firstName); // Rules #3, #4
    await this.selectExactUser(user);          // Rules #5, #6
    await this.verifyUserContext(user);         // Rule #8
  }

  /**
   * Rules #11 + #12: Exit impersonation and return to admin dashboard.
   *
   * Strategy: Re-login as admin. Navigating directly to /admin/dashboard from
   * the tenant app redirects to the sign-in page (session separation), so the
   * safest exit is a fresh admin login which is fast thanks to browser caching.
   *
   * TODO: If the app adds an "Exit impersonation" button to the tenant UI
   *       (e.g., in the DF avatar menu), replace this with that selector.
   */
  async exitImpersonation(): Promise<void> {
    const adminEmail    = process.env.ADMIN_EMAIL    ?? 'tien@paxel.ai';
    const adminPassword = process.env.ADMIN_PASSWORD ?? 'Paxel123';

    await this.page.goto('/admin/signin');
    await this.page.getByPlaceholder('Enter your email').fill(adminEmail);
    await this.page.getByPlaceholder('Enter your password').fill(adminPassword);
    await this.page.getByRole('button', { name: 'Sign In' }).click();
    await this.page.waitForURL('**/admin/dashboard', { timeout: 20_000 });
    await this.page.waitForTimeout(1_500); // networkidle never fires on polling dashboards

    // Rule #12: The tenant "Welcome back" greeting must be gone
    await expect(this.welcomeGreeting).not.toBeVisible({ timeout: 8_000 });
  }
}
