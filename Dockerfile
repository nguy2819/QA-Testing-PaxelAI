FROM mcr.microsoft.com/playwright:v1.58.2-jammy

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Denver

RUN apt-get update && apt-get install -y --no-install-recommends \
    tzdata \
    xvfb \
    x11vnc \
    x11-utils \
    fluxbox \
    novnc \
    python3-websockify \
    net-tools \
    procps \
    iproute2 \
    && ln -fs /usr/share/zoneinfo/$TZ /etc/localtime \
    && dpkg-reconfigure -f noninteractive tzdata \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/novnc \
  && if [ -f /usr/share/novnc/vnc.html ]; then cp -r /usr/share/novnc/* /app/novnc/; fi \
  && if [ -f /usr/share/noVNC/vnc.html ]; then cp -r /usr/share/noVNC/* /app/novnc/; fi \
  && if [ -f /opt/novnc/vnc.html ]; then cp -r /opt/novnc/* /app/novnc/; fi \
  && if [ -f /opt/noVNC/vnc.html ]; then cp -r /opt/noVNC/* /app/novnc/; fi
  
# Verify every binary exists at build time — fail fast if something is missing
RUN which Xvfb     || { echo "MISSING: Xvfb";     exit 1; } && \
    which x11vnc   || { echo "MISSING: x11vnc";   exit 1; } && \
    which fluxbox  || { echo "MISSING: fluxbox";  exit 1; } && \
    which websockify || { echo "MISSING: websockify"; exit 1; } && \
    ls /usr/share/novnc/vnc.html || { echo "MISSING: /usr/share/novnc/vnc.html"; exit 1; }

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .

# Render injects $PORT and routes public traffic there.
# websockify stays on :6080 internally — it is never publicly exposed.
EXPOSE 3001

CMD ["/bin/bash", "/app/docker/start.sh"]
