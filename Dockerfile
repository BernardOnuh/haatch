# Haatch: backend + Telegram bot + OpenCode workers + flyer/video renderer in one container.
FROM node:24-bookworm-slim

# Chromium renders flyers/videos, ffmpeg encodes MP4, fonts cover emoji and fallbacks.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ffmpeg ca-certificates curl unzip fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# OpenCode CLI: the worker agents. The backend spawns `opencode serve` itself.
RUN curl -fsSL https://opencode.ai/install | bash \
    && ln -s /root/.opencode/bin/opencode /usr/local/bin/opencode \
    && opencode --version

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:pay

ENV NODE_ENV=production \
    CHROME_PATH=/usr/bin/chromium \
    DATABASE_PATH=/data/app.db
# SQLite database + rendered assets live here; mount a persistent volume.
VOLUME /data
EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
