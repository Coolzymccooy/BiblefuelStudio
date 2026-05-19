# Biblefuel Studio (server) - Docker deploy (Coolify-ready)
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

# Ensure persistence directories exist so volume mounts have a parent.
RUN mkdir -p /app/data /app/outputs

# Anonymous volumes ensure that even without an explicit Coolify mount these
# paths survive container restarts (data) and never get baked into the image.
# In Coolify, mount named persistent volumes at /app/data and /app/outputs so
# the library, jobs, scripts history, rendered MP4s, and Edge-TTS audio all
# survive redeploys. See deploy/COOLIFY.md.
VOLUME ["/app/data", "/app/outputs"]

ENV NODE_ENV=production
EXPOSE 10000

CMD ["node", "index.js"]
