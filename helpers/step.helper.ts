import { Page } from '@playwright/test';
import * as fs   from 'fs';
import * as path from 'path';

// ── Live capture (continuous screenshots for the dashboard live feed) ──────────
let _captureTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start capturing screenshots every 400 ms to `dashboard/run/screenshots/live.jpg`.
 * The dashboard polls this file to show a near-real-time browser view.
 * Call this once per test (e.g. in beforeEach after login).
 */
export function startLiveCapture(page: Page): void {
  stopLiveCapture();
  const livePath = path.join(process.cwd(), 'dashboard', 'run', 'screenshots', 'live.jpg');
  // Take one immediately so the feed shows something right away (don't wait 400ms)
  page.screenshot({ path: livePath, type: 'jpeg', quality: 55 }).catch(() => {});
  _captureTimer = setInterval(async () => {
    try {
      await page.screenshot({ path: livePath, type: 'jpeg', quality: 55 });
    } catch { /* mid-navigation — safe to skip */ }
  }, 400);
}

/** Stop the live capture loop (call in afterEach). */
export function stopLiveCapture(): void {
  if (_captureTimer !== null) {
    clearInterval(_captureTimer);
    _captureTimer = null;
  }
}

const RUN_DIR  = path.join(process.cwd(), 'dashboard', 'run');
const LOG_FILE = path.join(RUN_DIR, 'current.jsonl');
const SS_DIR   = path.join(RUN_DIR, 'screenshots');

/** Call once at the start of a test run to reset the log and screenshots. */
export function initRun(): void {
  fs.mkdirSync(SS_DIR, { recursive: true });
  // Wipe previous run
  fs.readdirSync(SS_DIR).forEach(f => {
    try { fs.unlinkSync(path.join(SS_DIR, f)); } catch {}
  });
  fs.writeFileSync(LOG_FILE, '');
}

/**
 * Log a step with an optional screenshot.
 *
 * @param page     - Playwright Page (pass null for non-browser steps)
 * @param message  - Human-readable step description
 * @param status   - 'running' (in progress), 'pass', 'fail', 'info'
 */
export async function logStep(
  page:    Page | null,
  message: string,
  status:  'running' | 'pass' | 'fail' | 'info' = 'running',
): Promise<void> {
  let screenshotFile = '';

  if (page) {
    try {
      const filename = `${Date.now()}.jpg`;
      await page.screenshot({
        path:    path.join(SS_DIR, filename),
        type:    'jpeg',
        quality: 65,
      });
      screenshotFile = filename;
    } catch {
      // Page may be mid-navigation — screenshot skipped, test continues
    }
  }

  const entry = { message, status, screenshot: screenshotFile, ts: Date.now() };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}
