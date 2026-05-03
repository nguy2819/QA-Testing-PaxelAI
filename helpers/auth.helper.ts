import { Page } from '@playwright/test';
import { AdminSignInPage } from '../pages/AdminSignInPage';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.dev' });

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BASE_URL = process.env.BASE_URL || 'https://devapp.paxel.ai';

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('Missing ADMIN_EMAIL or ADMIN_PASSWORD in .env.dev file');
}

/**
 * Logs into the admin panel using credentials from the environment.
 * Call this in test.beforeEach for any test that needs an authenticated session.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  const signIn = new AdminSignInPage(page);

  await page.goto(`${BASE_URL}/admin/signin`, { waitUntil: 'networkidle' });
  await signIn.login(ADMIN_EMAIL as string, ADMIN_PASSWORD as string);

  await page.waitForURL(url => !url.pathname.includes('/admin/signin'), { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
}