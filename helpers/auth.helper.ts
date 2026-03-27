import { Page } from '@playwright/test';
import { AdminSignInPage } from '../pages/AdminSignInPage';

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    ?? 'tien@paxel.ai';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Paxel123';

/**
 * Logs into the admin panel using credentials from the environment.
 * Call this in test.beforeEach for any test that needs an authenticated session.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  const signIn = new AdminSignInPage(page);
  await signIn.login(ADMIN_EMAIL, ADMIN_PASSWORD);
}
