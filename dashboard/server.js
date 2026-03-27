/**
 * dashboard/server.js
 * QA Dashboard server — serves the HTML UI and streams Playwright test output.
 *
 * Start: npm run dashboard
 * Open:  http://localhost:3001
 */

const express = require('express');
const { spawn, exec } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const cors = require('cors');

const app        = express();
const PORT = process.env.PORT || 3001;
const PROJECT    = path.join(__dirname, '..');
const RUN_DIR    = path.join(__dirname, 'run');
const LOG_FILE   = path.join(RUN_DIR, 'current.jsonl');
const SS_DIR     = path.join(RUN_DIR, 'screenshots');

// Ensure run dirs exist
fs.mkdirSync(SS_DIR, { recursive: true });

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(__dirname));                          // serves index.html
app.use('/screenshots', express.static(SS_DIR));            // serves screenshots
app.use(cors());

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

/** Kill a spawned process and its entire Windows process tree. */
function killProc(proc) {
  if (!proc) return;
  // PowerShell kills the whole process tree reliably on Windows
  try {
    exec(
      `powershell -Command "Get-Process -Id ${proc.pid} -ErrorAction SilentlyContinue | Stop-Process -Force; Get-WmiObject Win32_Process | Where-Object {$_.ParentProcessId -eq ${proc.pid}} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      () => {}
    );
  } catch {}
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
    HEADLESS:       '1',       // run browser hidden — dashboard left panel is the view
    FORCE_COLOR:    '0',
    CI:             '0',
  };

  currentProc = spawn(
    'npx',
    ['playwright', 'test', specFile, '--reporter=line', '--workers=1', '--timeout=90000'],
    { env, cwd: PROJECT, shell: true },
  );

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
app.listen(PORT, () => {
  console.log(`\n  🧪 Paxel.AI QA Dashboard`);
  console.log(`  ➜  http://localhost:${PORT}\n`);
});
