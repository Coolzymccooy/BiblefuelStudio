# OpenCode server for Coolify
# Runs `opencode serve` headlessly so external apps (e.g. biblefuel-studio)
# can hit it as an LLM proxy. Configure the underlying provider via env vars
# (MINIMAX_API_KEY for the free MiniMax M2.7 model).

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates git bash \
    && rm -rf /var/lib/apt/lists/*

# Install opencode. Try npm first (clean install), fall back to the official
# install script (curl) which handles platform-binary downloads if npm fails.
# This double-path makes the build resilient to upstream packaging changes.
RUN set -eux; \
    (npm install -g opencode-ai@latest && opencode --version) \
    || ( \
        echo "[opencode] npm install failed, falling back to curl installer" \
        && curl -fsSL https://opencode.ai/install | bash \
        && ln -sf "$HOME/.opencode/bin/opencode" /usr/local/bin/opencode \
        && opencode --version \
    )

# Coolify-friendly: run as non-root for safety, but ensure the config dir exists
RUN useradd --create-home --shell /bin/bash opencode
USER opencode
WORKDIR /home/opencode

# Pre-seed opencode config; it interpolates {env:VAR} at runtime.
RUN mkdir -p /home/opencode/.config/opencode /home/opencode/workspace
COPY --chown=opencode:opencode opencode.json /home/opencode/.config/opencode/opencode.json

# Default port (overridable via PORT env)
ENV PORT=4096
EXPOSE 4096

# Healthcheck: opencode serves an OpenAPI doc at /doc
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/doc" >/dev/null || exit 1

WORKDIR /home/opencode/workspace

# 0.0.0.0 so the container is reachable from outside (Coolify proxy).
# Server password comes from OPENCODE_SERVER_PASSWORD; if unset, server is
# unauthenticated — do NOT deploy without setting it in production.
CMD ["sh", "-c", "exec opencode serve --hostname 0.0.0.0 --port ${PORT}"]
