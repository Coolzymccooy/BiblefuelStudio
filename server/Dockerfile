# Biblefuel Studio (server) - Render Docker deploy
FROM node:22-bookworm-slim

# Install ffmpeg + ffprobe
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy app
COPY . .

ENV NODE_ENV=production
EXPOSE 10000

CMD ["node", "index.js"]
