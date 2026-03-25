# Biblefuel Studio (server) - Render Docker deploy
FROM node:22-bookworm

# Install ffmpeg + ffprobe with all codec dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

# Install deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy app
COPY . .

ENV NODE_ENV=production
EXPOSE 10000

CMD ["node", "index.js"]
