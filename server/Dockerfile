# Biblefuel Studio — Docker deploy (Coolify-ready)
#
# IMPORTANT: this Dockerfile expects the build context to be the REPO ROOT,
# not server/. In Coolify set base_directory=/ and dockerfile_location=
# /server/Dockerfile. The client is a sibling of server/, so a server-only
# context cannot reach it.
#
# The client bundle is now a BUILD ARTIFACT produced here (stage 1), not a
# file committed under server/public. This makes it impossible to ship a
# bundle that was built without the Firebase web keys — the previous outage
# (client fell back to local auth → 401 for every Firebase user) cannot recur
# because the build hard-fails if the keys are absent (see assertion below).

# ---------- Stage 1: build the client bundle ----------
FROM node:22-bookworm AS client-build
WORKDIR /build

# Prefer IPv4 for npm/registry resolution. Some build networks have broken
# IPv6 routing and npm ci dies mid-download with ECONNRESET otherwise.
# The npm_config_* vars add retry/backoff so a transient reset doesn't fail
# the whole build.
ENV NODE_OPTIONS=--dns-result-order=ipv4first \
    npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_fetch_timeout=600000

# Firebase WEB config — NON-SECRET. These values are inlined into the browser
# bundle and are already visible to every visitor; they are NOT credentials.
# Passed as build args so Vite can inline them at build time (import.meta.env).
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_MEASUREMENT_ID
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID \
    VITE_FIREBASE_MEASUREMENT_ID=$VITE_FIREBASE_MEASUREMENT_ID

# Install client deps (incl. devDeps: vite + tsc) from the lockfile first so
# this layer caches across source-only changes.
COPY client/package.json client/package-lock.json ./client/
# Triple-try: a fresh npm process recovers from a transient ECONNRESET that
# in-process fetch-retries don't (broken IPv6 routing on some build networks).
RUN npm ci --prefix client || npm ci --prefix client || npm ci --prefix client

# Build. vite.config outDir is ../server/public, so output lands at
# /build/server/public (emptyOutDir wipes stale assets first).
COPY client ./client
RUN npm run build --prefix client

# Hard guard: the deployed bundle MUST carry the Firebase web key. If the
# VITE_FIREBASE_* build args were not supplied, the bundle has no key and the
# client would silently fall back to local auth (401 for all Firebase users).
# Fail the build loudly instead of shipping a broken login.
RUN grep -rq "AIzaSy" server/public/assets \
    || (echo "BUILD FAILED: client bundle has no Firebase key — set the VITE_FIREBASE_* build args in Coolify (base_directory must be / and dockerfile /server/Dockerfile)." && exit 1)

# ---------- Stage 2: server runtime ----------
FROM node:22-bookworm
WORKDIR /app

# Prefer IPv4 for npm/registry resolution (see stage 1 note). Also applies at
# runtime to any outbound node fetch on IPv6-broken networks.
ENV NODE_OPTIONS=--dns-result-order=ipv4first \
    npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_fetch_timeout=600000

# ffmpeg + ffprobe with codec deps (rendering / waveform / TTS muxing).
RUN apt-get update && apt-get install -y \
    ffmpeg \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Server deps (production only).
COPY server/package.json server/package-lock.json* ./
# Triple-try (see stage 1 note).
RUN npm ci --omit=dev || npm ci --omit=dev || npm ci --omit=dev

# Server source.
COPY server ./

# Replace any committed bundle with the freshly built one from stage 1. This
# is the single source of truth for the served client.
COPY --from=client-build /build/server/public ./public

# Ensure persistence dirs exist so volume mounts have a parent.
RUN mkdir -p /app/data /app/outputs

# Anonymous volumes ensure these paths survive restarts even without an
# explicit Coolify mount. In Coolify, mount named persistent volumes at
# /app/data and /app/outputs. See deploy/COOLIFY.md.
VOLUME ["/app/data", "/app/outputs"]

ENV NODE_ENV=production
EXPOSE 10000

CMD ["node", "index.js"]
