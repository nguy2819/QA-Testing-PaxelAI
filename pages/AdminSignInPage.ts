import { Page, Locator } from '@playwright/test';

/**
 * AdminSignInPage
 * URL: /admin/signin
 *
 * Handles admin authentication before impersonation can begin.
 * All selectors are best-effort — TODO comments mark where real selectors are needed.
 */
export class AdminSignInPage {
  readonly page: Page;

  // TODO: Verify these locators against the actual /admin/signin page DOM.
  // Prefer getByLabel or getByPlaceholder once real labels are confirmed.
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;

    // Email input — try placeholder first, then type="email", then input[name*="email"]
    this.emailInput = page.getByPlaceholder('Enter your email')
      .or(page.locator('input[type="email"]').first())
      .or(page.locator('input[name*="email" i], input[id*="email" i]').first());

    // Password input — try placeholder first, then type="password"
    this.passwordInput = page.getByPlaceholder('Enter your password')
      .or(page.locator('input[type="password"]').first());

    // Sign in button — try exact "Sign In", then case-insensitive, then submit
    this.signInButton = page.getByRole('button', { name: 'Sign In', exact: true })
      .or(page.getByRole('button', { name: /sign.?in/i }).first())
      .or(page.locator('button[type="submit"]').first());

    this.errorMessage = page
      .locator('[data-testid="auth-error"]')
      .or(page.getByText(/invalid|incorrect|failed/i));
  }

  async goto() {
    await this.page.goto('/admin/signin');
    // Wait for the page to be interactive before interacting with inputs
    await this.page.waitForLoadState('domcontentloaded');
  }

  async login(email: string, password: string): Promise<void> {
    await this.goto();

    // Log current URL + page title to help debug any redirect issues
    const url   = this.page.url();
    const title = await this.page.title().catch(() => '?');
    console.log(`[AdminSignInPage] At URL: ${url}  title: "${title}"`);

    // If already redirected away from signin (e.g. already authenticated), skip fill
    if (!this.page.url().includes('/admin/signin')) {
      console.log('[AdminSignInPage] Not on signin page — already authenticated, skipping fill');
      return;
    }

    await this.emailInput.fill(email, { timeout: 10_000 });
    await this.passwordInput.fill(password, { timeout: 10_000 });
    await this.signInButton.click({ timeout: 10_000 });

    // Wait for redirect away from the sign-in page
    await this.page.waitForURL(
      url => !url.pathname.includes('/admin/signin'),
      { timeout: 25_000 },
    );
  }
}
