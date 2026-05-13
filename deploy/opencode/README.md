# OpenCode server — Coolify deployment (PARKED)

> ⚠️ **Status: parked behind a feature flag.** The biblefuel-studio server
> ignores opencode unless `OPENCODE_ENABLED=true` is set. Read the "Pick a real
> free provider first" section below before deploying — the default config
> assumes MiniMax-direct, which is *paid*, not free.

This folder packages [`opencode serve`](https://opencode.ai/docs/server/) so it
can be deployed on a Coolify instance and used as an LLM backend by
biblefuel-studio (or any other app that wants an OpenAI-shaped proxy).

The deployed server runs `opencode` in headless HTTP mode pointing at whichever
provider is wired up in [`opencode.json`](./opencode.json). Switching providers
is a config change in that file plus a redeploy.

## Pick a real free provider first

When this was first set up, we believed MiniMax M2.7 was free on opencode. It's
free *inside the opencode terminal* via **OpenCode Zen** (a limited-time
promo), but the **direct MiniMax API is paid**: ~$0.28/$1.20 per million
input/output tokens. Before deploying, pick one:

| Provider | Free? | Setup |
|---|---|---|
| **OpenRouter `:free` models** | ✅ Ongoing free (Llama 3, Mistral, Gemma free tiers) | Get an `OPENROUTER_API_KEY`, change `opencode.json` to use `openrouter` provider + a `:free` model id |
| **OpenCode Zen MiniMax M2.7** | ⚠️ Free *while promo lasts* | Sign in at opencode.ai → get Zen API key → put in `opencode.json` under provider `opencode` |
| **MiniMax direct (default)** | ❌ Paid | Cheapest plan $10/mo (1500 req / 5h). Defeats "free" goal. |
| **Local Ollama** | ✅ Free + private | Deploy Ollama alongside opencode on the same Coolify box; needs decent CPU/GPU |

## Activation checklist (when you're ready)

1. Edit `opencode.json` to use the provider you picked above
2. In Coolify env vars for **biblefuel-studio** (not this opencode service):
   - `OPENCODE_ENABLED=true`  ← lifts the feature flag
   - `OPENCODE_BASE_URL=https://<your-opencode-domain>`
   - `OPENCODE_SERVER_PASSWORD=<same as deployed below>`

## What you get

- A `POST /session` + `POST /session/:id/message` HTTP API on port `4096`
- HTTP basic auth (`OPENCODE_SERVER_PASSWORD`)
- An OpenAPI 3.1 spec at `/doc` (also used as the Docker healthcheck)

## Prerequisites

1. A Coolify v4 instance with a connected server.
2. A MiniMax API key — sign up at <https://platform.minimax.io/> and create a
   Token Plan key. MiniMax M2.7 is currently free on opencode (limited time
   feedback program).
3. A long random `OPENCODE_SERVER_PASSWORD` (e.g. `openssl rand -hex 24`).

## Deploy to Coolify — step by step

1. **Coolify → New Resource → Public Repository → Docker Compose**
2. Repository URL: `https://github.com/<you>/biblefuel-studio`
3. **Base Directory:** `/deploy/opencode`
4. **Docker Compose Location:** `/docker-compose.yml`
5. **Build Pack:** `Docker Compose`
6. **Environment Variables** (under Configuration → Environment Variables):
   - `MINIMAX_API_KEY` — paste your MiniMax key
   - `OPENCODE_SERVER_PASSWORD` — paste your generated password
   - (optional) `OPENCODE_SERVER_USERNAME` — defaults to `opencode`
7. **Network → Ports / Domains**:
   - Set Service Port to `4096`
   - Assign a domain (Coolify auto-issues an HTTPS cert)
8. Click **Deploy**.

When the container is healthy, hit `https://<your-domain>/doc` in a browser
to see the OpenAPI page. That confirms the server is up.

## Wire biblefuel-studio to the deployed opencode

In `biblefuel-studio/server/.env`:

```env
OPENCODE_BASE_URL=https://<your-opencode-domain>
OPENCODE_SERVER_PASSWORD=<same password you set in Coolify>
OPENCODE_SERVER_USERNAME=opencode
```

biblefuel will now use opencode → MiniMax M2.7 as its primary script generator
([`server/src/lib/generateScripts.js`](../../server/src/lib/generateScripts.js)
cascade: opencode → gemini → openai → deterministic fallback pool).

## Test it manually

```bash
# 1. Confirm the server is reachable
curl -u opencode:$OPENCODE_SERVER_PASSWORD https://<your-domain>/doc

# 2. Create a session
SESSION_ID=$(curl -s -u opencode:$OPENCODE_SERVER_PASSWORD \
  -X POST https://<your-domain>/session \
  -H "Content-Type: application/json" \
  -d '{"title":"smoke-test"}' | jq -r '.id // .info.id')

# 3. Send a prompt
curl -u opencode:$OPENCODE_SERVER_PASSWORD \
  -X POST https://<your-domain>/session/$SESSION_ID/message \
  -H "Content-Type: application/json" \
  -d '{"parts":[{"type":"text","text":"Say hello in five words."}]}'
```

The response is `{ info: {...}, parts: [...] }`; the model reply lives in
`parts[i].text` for any part where `type === "text"`.

## Switching models

The currently-free model is set in [`opencode.json`](./opencode.json) as
`minimax/MiniMax-M2.7`. To use a different free or paid model (e.g. when
MiniMax's free window closes), edit that file and redeploy. Common alternates:

- **Ring 2.6 1T Free** — also free on opencode (limited time)
- **OpenRouter** — set `provider.openrouter.options.apiKey` + `model` to any
  OpenRouter model id (free models include `mistralai/mistral-7b-instruct:free`)
- **Anthropic / OpenAI / Gemini** — set the corresponding provider block

Full provider list: <https://opencode.ai/docs/providers/>

## Why not just call MiniMax directly?

You could — but opencode gives you (1) provider-agnostic indirection (swap
models without changing biblefuel code), (2) session/message semantics so
multi-turn use cases work later, and (3) a stable HTTP surface even when
underlying providers churn their APIs.

## Memory reference

See [opencode_integration.md](../../../../../.claude/projects/c--Users-segun-source-repos-biblefuel-studio/memory/opencode_integration.md)
for the wire-protocol notes biblefuel-studio uses on the client side.
