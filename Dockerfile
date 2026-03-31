FROM mcr.microsoft.com/playwright:v1.58.2-jammy

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Denver

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    tzdata \
    xvfb \
    x11vnc \
    x11-utils \
    fluxbox \
    python3-websockify \
    net-tools \
    procps \
    iproute2 \
    && ln -fs /usr/share/zoneinfo/$TZ /etc/localtime \
    && dpkg-reconfigure -f noninteractive tzdata \
    && rm -rf /var/lib/apt/lists/*

# Put noVNC in a stable app-owned path
RUN git clone --depth=1 https://github.com/novnc/noVNC.git /app/novnc \
    && rm -rf /app/novnc/.git

# Verify binaries and noVNC files exist at build time
RUN which Xvfb || { echo "MISSING: Xvfb"; exit 1; } && \
    which x11vnc || { echo "MISSING: x11vnc"; exit 1; } && \
    which fluxbox || { echo "MISSING: fluxbox"; exit 1; } && \
    which websockify || { echo "MISSING: websockify"; exit 1; } && \
    test -f /app/novnc/vnc.html || { echo "MISSING: /app/novnc/vnc.html"; exit 1; }

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3001

CMD ["/bin/bash", "/app/docker/start.sh"]