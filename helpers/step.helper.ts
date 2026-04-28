// Live browser view is served via the noVNC/x11vnc/websockify pipeline.
// Playwright does NOT take screenshots — it only writes text log entries.
import * as fs   from 'fs';
import * as path from 'path';

const RUN_DIR   = path.join(process.cwd(), 'dashboard', 'run');
const LOG_FILE  = path.join(RUN_DIR, 'current.jsonl');
const PAUSE_FILE = path.join(RUN_DIR, 'pause.flag');

/** Call once at the start of a test run to reset the log file. */
export function initRun(): void {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, '');

  if (fs.existsSync(PAUSE_FILE)) {
    fs.unlinkSync(PAUSE_FILE);
  }
}

/**
 * Blocks until the pause flag is removed (i.e. until Resume is clicked).
 * Safe to call before any step — resolves immediately when not paused.
 */
export async function waitIfPaused(): Promise<void> {
  while (fs.existsSync(PAUSE_FILE)) {
    await new Promise<void>(resolve => setTimeout(resolve, 250));
  }
}

/**
 * Append a text-only step entry to the JSONL log.
 * Waits for resume before writing any 'running' entry so the test
 * genuinely halts between steps while paused.
 *
 * @param _page   - Accepted for call-site compatibility; not used (no screenshots).
 * @param message - Human-readable step description.
 * @param status  - 'running' | 'pass' | 'fail' | 'info'
 */
export async function logStep(
  _page:   unknown,
  message: string,
  status:  'running' | 'pass' | 'fail' | 'info' = 'running',
): Promise<void> {
  if (status === 'running') {
    await waitIfPaused();
  }
  const entry = { message, status, ts: Date.now() };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}
