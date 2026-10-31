# Haatch: backend + Telegram bot + OpenCode workers + flyer/video renderer in one container.
# Runs as a non-root user (uid 1000), as Hugging Face Spaces require; works on Railway/Render/Fly too.
FROM node:24-bookworm-slim

# Chromium renders flyers/videos, ffmpeg encodes MP4, fonts cover emoji and fallbacks.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ffmpeg ca-certificates curl unzip fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# OpenCode CLI: the worker agents. Copy the binary somewhere every user can run it.
RUN curl -fsSL https://opencode.ai/install | bash \
    && cp /root/.opencode/bin/opencode /usr/local/bin/opencode \
    && chmod 755 /usr/local/bin/opencode \
    && opencode --version

# node:24 images ship a uid-1000 user called "node"; run everything as that user.
RUN mkdir -p /data && chown node:node /data
USER node
ENV HOME=/home/node
WORKDIR /home/node/app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node . .
RUN npm run build:pay

ENV NODE_ENV=production \
    CHROME_PATH=/usr/bin/chromium \
    DATABASE_PATH=/data/app.db \
    PORT=3000
# SQLite database + rendered assets. Mount a persistent volume here if your host offers one.
VOLUME /data
EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
