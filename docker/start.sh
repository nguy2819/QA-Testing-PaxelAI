
#!/bin/bash
# docker/start.sh — boots Xvfb → fluxbox → x11vnc → websockify → Node
# Each daemon is verified ready before the next one starts.

set -e

# ── helpers ────────────────────────────────────────────────────────────────────
wait_for_port() {
  local port=$1 label=$2 tries=0 max=40
  echo "  Waiting for $label on :$port ..."
  while ! ss -ltn | grep -q ":${port} "; do
    tries=$((tries+1))
    if [ $tries -ge $max ]; then
      echo "❌ Timeout: $label did not bind to :$port after ${max} attempts"
      exit 1
    fi
    sleep 0.5
  done
  echo "  ✅ $label is listening on :$port"
}

wait_for_display() {
  local tries=0 max=30
  echo "  Waiting for DISPLAY=:99 ..."
  while ! xdpyinfo -display :99 >/dev/null 2>&1; do
    tries=$((tries+1))
    if [ $tries -ge $max ]; then
      echo "❌ Timeout: Xvfb did not create DISPLAY=:99"
      exit 1
    fi
    sleep 0.5
  done
  echo "  ✅ DISPLAY=:99 is ready"
}

# ── 1. Virtual display ─────────────────────────────────────────────────────────
echo "[1/5] Starting Xvfb on DISPLAY=:99 ..."
Xvfb :99 -screen 0 1440x900x24 -ac &
export DISPLAY=:99
wait_for_display

# ── 2. Window manager ──────────────────────────────────────────────────────────
echo "[2/5] Starting fluxbox ..."
fluxbox -display :99 >/dev/null 2>&1 &
sleep 1   # fluxbox has no port to probe; 1 s is enough

# ── 3. VNC server ──────────────────────────────────────────────────────────────
echo "[3/5] Starting x11vnc on port 5900 ..."
# NOTE: no -quiet so errors are visible in docker logs
x11vnc \
  -display :99 \
  -nopw \
  -shared \
  -forever \
  -rfbport 5900 \
  -xkb \
  &
wait_for_port 5900 "x11vnc"

# ── 4. WebSocket bridge + noVNC static files ───────────────────────────────────
echo "[4/5] Starting websockify + noVNC on port 6080 ..."
# --web  serves /usr/share/novnc as HTTP (so vnc.html loads)
# 6080   WebSocket listen port
# localhost:5900  upstream VNC TCP target
websockify \
  --web /app/novnc \
  6080 \
  localhost:5900 \
  &
wait_for_port 6080 "websockify/noVNC"

# ── 5. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "✅ VNC stack is fully up"
echo "   DISPLAY   : :99 (Xvfb 1440x900)"
echo "   VNC TCP   : localhost:5900"
echo "   noVNC UI  : http://localhost:6080/vnc.html"
echo "   Dashboard : http://localhost:3001"
echo ""

# ── 6. Node server ─────────────────────────────────────────────────────────────
echo "Checking noVNC locations..."
for d in /usr/share/novnc /usr/share/noVNC /opt/novnc /opt/noVNC; do
  if [ -f "$d/vnc.html" ]; then
    echo "✅ Found noVNC at: $d"
    ls -la "$d" | head
  else
    echo "❌ Not found: $d"
  fi
done
echo "[5/5] Starting Node dashboard server ..."
exec node /app/dashboard/server.js
