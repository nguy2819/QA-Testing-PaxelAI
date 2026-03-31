/**
 * dashboard/server.js
 * QA Dashboard server — serves the HTML UI and streams Playwright test output.
 *
 * Start: npm run dashboard
 * Open:  http://localhost:3001
 */

const express = require('express');
const http    = require('http');
const { spawn, exec } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app        = express();
const PORT = process.env.PORT || 3001;
const PROJECT    = path.join(__dirname, '..');
const RUN_DIR    = path.join(__dirname, 'run');
const LOG_FILE   = path.join(RUN_DIR, 'current.jsonl');
const SS_DIR     = path.join(RUN_DIR, 'screenshots');
const APP_ROOT = path.join(__dirname, '..');

const NOVNC_CANDIDATES = [
  path.join(APP_ROOT, 'novnc'),   // ✅ THIS is your real path
  '/usr/share/novnc',
  '/usr/share/noVNC',
  '/opt/novnc',
  '/opt/noVNC',
];

const NOVNC_DIR = NOVNC_CANDIDATES.find((dir) =>
  fs.existsSync(path.join(dir, 'vnc.html'))
);

const NOVNC_HTML = NOVNC_DIR ? path.join(NOVNC_DIR, 'vnc.html') : null;

console.log('[startup] /app exists:', fs.existsSync('/app'));
console.log('[startup] /app/novnc exists:', fs.existsSync('/app/novnc'));
console.log('[startup] /app/novnc/vnc.html exists:', fs.existsSync('/app/novnc/vnc.html'));

if (fs.existsSync('/app')) {
  try {
    console.log('[startup] /app sample:', fs.readdirSync('/app').slice(0, 20));
  } catch (e) {
    console.log('[startup] Could not read /app:', e.message);
  }
}

if (fs.existsSync(path.join(APP_ROOT, 'novnc'))) {
  try {
    console.log('[startup] /app/novnc sample:', fs.readdirSync('/app/novnc').slice(0, 20));
  } catch (e) {
    console.log('[startup] Could not read /app/novnc:', e.message);
  }
}

// Ensure run dirs exist
fs.mkdirSync(SS_DIR, { recursive: true });

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(__dirname));                          // serves index.html
app.use('/screenshots', express.static(SS_DIR));            // serves screenshots
app.use(cors());

// ── noVNC static files — served at /novnc/ so the iframe can load vnc.html ──
// This path only exists inside Docker (/usr/share/novnc). On Windows dev the
// directory won't be present — the route simply returns 404, which is fine
// because the noVNC panel only makes sense inside Docker anyway.
app.get('/novnc/vnc.html', (req, res, next) => {
  if (!NOVNC_HTML) {
    return res.status(404).send(
      `noVNC file missing. Checked: ${NOVNC_CANDIDATES.join(', ')}`
    );
  }

  res.sendFile(NOVNC_HTML, (err) => {
    if (err) next(err);
  });
});

if (NOVNC_DIR) {
  app.use('/novnc', express.static(NOVNC_DIR));
}

// ── WebSocket proxy — /websockify → websockify on :6080 (internal only) ──────
// noVNC connects via `path=websockify` query param. Render only exposes one
// public port, so we forward the WS upgrade through Express instead of
// pointing the browser directly at :6080.
const vncProxy = createProxyMiddleware({
  target: 'http://localhost:6080',
  ws: true,
  changeOrigin: true,
  logLevel: 'silent',
});
app.use('/websockify', vncProxy);

// ── Spec map ──────────────────────────────────────────────────────────────────
const SPEC_MAP = {
  'sales-summary':    'tests/regression/sales-summary.regression.spec.ts',
  'accounts':         'tests/regression/accounts.regression.spec.ts',
  'opportunities':    'tests/regression/opportunities.regression.spec.ts',
  'contracts-pricing':'tests/regression/contracts-pricing.regression.spec.ts',
  'contacts':         'tests/regression/contacts.regression.spec.ts',
};

// ── State ─────────────────────────────────────────────────────────────────────
let currentProc = null;
let runStatus   = 'idle'; // idle | running | done

/** Kill a spawned process and its entire child tree.
 *  In Docker/Linux we kill the process group (negative PID).
 *  On Windows (local dev) we fall back to the PowerShell tree-kill. */
function killProc(proc) {
  if (!proc) return;
  if (process.platform === 'win32') {
    try {
      exec(
        `powershell -Command "Get-Process -Id ${proc.pid} -ErrorAction SilentlyContinue | Stop-Process -Force; Get-WmiObject Win32_Process | Where-Object {$_.ParentProcessId -eq ${proc.pid}} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
        () => {}
      );
    } catch {}
  } else {
    // Linux/Docker: kill the entire process group spawned with detached:true
    try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
  }
  try { proc.kill('SIGTERM'); } catch {}
}

// ── POST /api/run ─────────────────────────────────────────────────────────────
app.post('/api/run', (req, res) => {
  const { email, password, page, role = 'salesrep', env: envName = 'dev' } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const specFile = SPEC_MAP[page];
  if (!specFile) {
    return res.status(400).json({ error: `Unknown page key: "${page}"` });
  }

  // Kill any running test
  if (currentProc) {
    killProc(currentProc);
    currentProc = null;
  }

  // Clear previous run files
  try {
    if (fs.existsSync(SS_DIR)) {
      fs.readdirSync(SS_DIR).forEach(f => {
        try { fs.unlinkSync(path.join(SS_DIR, f)); } catch {}
      });
    }
    fs.writeFileSync(LOG_FILE, '');
  } catch {}

  runStatus = 'running';

  const env = {
    ...process.env,
    ADMIN_EMAIL:    email,
    ADMIN_PASSWORD: password,
    BASE_ENV:       envName,
    ROLE:           role,      // salesrep | director | executive
    HEADLESS:       '0',       // headed — browser renders on Xvfb and streams via noVNC
    DISPLAY:        process.env.DISPLAY || ':99', // virtual display created by Xvfb in Docker
    FORCE_COLOR:    '0',
    CI:             '0',
  };

  currentProc = spawn(
    'npx',
    ['playwright', 'test', specFile, '--reporter=line', '--workers=1', '--timeout=90000'],
    // detached:true creates a new process group — required so killProc(-pid) kills
    // the whole tree (npx → node → playwright → chromium) on Linux/Docker.
    { env, cwd: PROJECT, shell: true, detached: process.platform !== 'win32' },
  );

  currentProc.stdout.on('data', (data) => {
  console.log('[playwright stdout]', data.toString());
});

currentProc.stderr.on('data', (data) => {
  console.error('[playwright stderr]', data.toString());
});

  currentProc.on('close', (code) => {
    runStatus   = 'done';
    currentProc = null;
    // Append a sentinel so the stream client knows the run finished
    const done = { message: code === 0 ? '✅ All tests completed.' : `⚠️ Run finished with exit code ${code}.`, status: code === 0 ? 'pass' : 'fail', screenshot: '', ts: Date.now(), _done: true };
    try { fs.appendFileSync(LOG_FILE, JSON.stringify(done) + '\n'); } catch {}
  });

  res.json({ ok: true });
});

// ── POST /api/stop ────────────────────────────────────────────────────────────
app.post('/api/stop', (req, res) => {
  if (currentProc) {
    killProc(currentProc);
    currentProc = null;
    runStatus = 'idle';
    const stopped = { message: '🛑 Test run stopped by user.', status: 'fail', screenshot: '', ts: Date.now(), _done: true };
    try { fs.appendFileSync(LOG_FILE, JSON.stringify(stopped) + '\n'); } catch {}
  }
  res.json({ ok: true });
});

// ── GET /api/stream ───────────────────────────────────────────────────────────
// Server-Sent Events — client connects and receives log entries as they appear.
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let lastPos = 0;

  const poll = () => {
    try {
      if (!fs.existsSync(LOG_FILE)) return;
      const stat = fs.statSync(LOG_FILE);
      if (stat.size <= lastPos) return;

      const fd  = fs.openSync(LOG_FILE, 'r');
      const buf = Buffer.alloc(stat.size - lastPos);
      fs.readSync(fd, buf, 0, buf.length, lastPos);
      fs.closeSync(fd);
      lastPos = stat.size;

      const lines = buf.toString('utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        res.write(`data: ${line}\n\n`);
      }
    } catch {
      // File may be locked briefly during write — retry next poll
    }
  };

  const interval = setInterval(poll, 150);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// ── GET /api/status ───────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({ status: runStatus });
});

// ── Start ─────────────────────────────────────────────────────────────────────
// Use http.createServer so WebSocket upgrade events (noVNC ↔ websockify proxy)
// are handled. app.listen() doesn't expose the underlying net.Server in a way
// that lets us attach the WS upgrade handler reliably.
const server = http.createServer(app);
server.on('upgrade', vncProxy.upgrade);   // forward browser WS upgrades to :6080

server.listen(PORT, () => {
  console.log(`\n  🧪 Paxel.AI QA Dashboard`);
  console.log(`  ➜  http://localhost:${PORT}\n`);
});
