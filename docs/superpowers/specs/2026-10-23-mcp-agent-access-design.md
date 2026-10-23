# Agents inside BibleFuel: an MCP server — design

Status: draft for the operator's approval (2026-10-23). Not yet built. The operator's
decisions so far: every feature in the app is reachable; publishing needs the key owner's
consent; a hard daily cap on every key while usage is being tested; an activity log to learn
from; a key never gets past its user's plan or role; one end-to-end guide.

## Intent

The operator runs agents (Hermes Agent, Codex, Claude Code, and others) and wants them to make
content with BibleFuel the way a person does in the app: write scripts, voice them, pick
backgrounds, build story videos, ambient sessions, lyric videos, moments, timelines, scene scripts,
series, long-form pieces and Gumroad packs, and publish the results. Today the only way in is the
browser. The server already has a complete HTTP API behind the app; this design puts a Model
Context Protocol (MCP) server in front of that API so any MCP-capable agent can call it with a
key, as the signed-in user, from anywhere.

The guiding rule: **the agent is the user.** It sees the same projects, pays the same quotas,
reaches the same outputs, and can do nothing the user could not do in the app.

## Goals

- Any MCP client that speaks Streamable HTTP connects to the live site with one URL and one key.
- Every creation feature in the app is reachable: scripts, voice, backgrounds and library, story
  video, ambient session, lyric video, moments, timeline, scene script, series, long-form,
  Gumroad, queue, music (vocal removal), branding, and publishing (YouTube, TikTok, webhook,
  auto-publish).
- Long renders work with agents whose tool calls time out: every slow step returns a job the
  agent can wait on and resume.
- Each user manages their own keys in Settings; a key is revocable and never shown twice.
- A key respects its user's access rights (plan, verified email, super-admin gates) and, on top
  of them, a hard daily cap on renders, paid generation, images, voice and publishes, so no
  agent, whoever owns it, can burn through the operator's provider credits while usage is
  still being tested.
- One guide, readable by people and agents, explains the whole thing end to end.
- No feature logic is duplicated. The MCP layer maps tools onto the existing routes.

## Non-goals

- A desktop stdio package. Clients that only speak stdio use `mcp-remote`, which bridges to the
  HTTP endpoint.
- OAuth for the MCP endpoint (needed by claude.ai custom connectors and Claude Desktop). Keys
  first; OAuth is a later slice, noted at the end.
- Admin operations (user management, access requests, billing). Never mapped.
- Pushing large files through MCP. Media comes in by URL import or the existing upload routes.
- A chat agent inside BibleFuel. This is the opposite direction: agents outside, BibleFuel as the
  tool.

## Anti-goals (a failure even if it works)

- An agent key that reaches another user's projects or outputs.
- A tool that bypasses quota, email verification, or the super-admin gate on scene scripts.
- A second implementation of any pipeline step that drifts from the app's.
- A key printed into logs, error messages, or the Settings page after creation.

## How it gets made (the operator's defaults, chosen by Claude)

- **Protocol**: MCP over Streamable HTTP, stateless. Endpoint `POST /api/mcp` (with `GET` and
  `DELETE` answering per spec) on the existing Express server, so the live site needs no new
  service, port, or Coolify change.
- **Library**: `@modelcontextprotocol/sdk` 1.32.x (the v1 line; maintained with fixes through at
  least January 2027). Only `server/src/mcp/transport.js` touches SDK transport types, so moving
  to the v2 packages later is one file.
- **Language**: plain JavaScript ES modules with JSDoc, like the rest of `server/`. Zod 3 (already
  a dependency) for every tool's input schema.
- **Client UI**: a "Connected agents" card on the Settings page, React + the existing `Card` and
  form controls, tokens from the product design system.

## Architecture

```
agent ──Streamable HTTP──▶ /api/mcp ──auth: agent key or JWT──▶ McpServer (per request)
                                                                  │ tool handler
                                                                  ▼
                                                      loopback fetch 127.0.0.1:PORT/api/…
                                                      with a 60-second internal JWT
                                                                  │
                                                                  ▼
                                          existing routes + requireAuth + withUserScope
                                          + requireVerifiedEmail + quota (unchanged)
```

### Request handling

- Each MCP request gets a fresh `McpServer` and transport with `sessionIdGenerator: undefined`
  (stateless). Nothing is kept between requests, so a Coolify restart loses no state and two
  agents never share a server object. DNS-rebinding protection is on with `allowedHosts` set to
  the public host(s) and `localhost`.
- The endpoint is mounted before the SPA fallback and outside the app's CORS allowlist (agents
  are not browsers; no `Origin` is expected). Helmet stays as is.
- Rate limit: 120 requests per minute per key, using the existing `express-rate-limit`.
- Per-call log line: `[MCP] key=<first 8 chars of the key id> tool=<name> ms=<n> ok|error`.
  Never the key itself.

### Authentication: agent keys

- Format: `bfk_` followed by 32 random bytes, base64url. Shown once at creation.
- Store: `DATA_DIR/agent-keys.json` (operator-level index, like `users.json`), one record per key:
  `{ id, hash (SHA-256 of the key), userId, name, createdAt, lastUsedAt, revokedAt }`. Lookup is
  by hash, compared in constant time (same helper the stems worker uses).
- **A key works at `/api/mcp` and nowhere else.** The app's `requireAuth` never accepts a
  `bfk_` key; a dedicated `requireAgentKeyOrJwt` middleware guards only the MCP endpoint, reads
  the `Authorization` header only (no `?token=` query fallback there), and builds `req.user` with
  the same claims a JWT carries (`sub`, `email`, `role`, `emailVerified` read live from
  `users.json`) plus `via: "agent-key"`. From there `withUserScope`, quotas, and the
  verified-email gate behave exactly as for the app. (Claude's call, after the builder check.)
- The loopback JWT carries `via: "mcp"`. A small `refuseAgentCalls` guard, mounted on the
  account and money routes (`DELETE /api/auth/me`, all of `/api/agent-keys`, `/api/billing`
  except `GET /usage`, `/api/admin`, `/api/access-requests`), answers 403 to any token with
  `via: "mcp"`. So even a tool added by mistake cannot delete the account, mint keys, or touch
  billing. The catalogue is the whitelist; this guard is the backstop.
- A bearer JWT from the app is also accepted at `/api/mcp`, so a developer can test with the
  token the browser already holds.
- Key routes, under the normal auth stack (JWT only): `GET /api/agent-keys` (list, never the
  hash), `POST /api/agent-keys { name }` (returns the key once), `DELETE /api/agent-keys/:id`
  (revoke). Limit: 10 live keys per user.
- A revoked or unknown key gets a 401 with a plain message; a key whose user no longer exists is
  treated as revoked.
- The constant-time compare moves to a shared `server/src/lib/secrets.js` (`sameSecret`), and
  the private copies in `routes/stemsWorker.js` and `routes/abi.js` switch to it.

### Dispatch: loopback, not in-process calls

Tool handlers call the server's own HTTP API at `http://127.0.0.1:<PORT>/api/...` with a
60-second JWT minted for that call (`sub`, `email`, `role`, `emailVerified` from the key's user;
`via: "mcp"`). Reasons:

- Every middleware the app relies on runs unchanged: scoping, quotas, verified email, the
  super-admin gate on scene scripts, the stems queue, upload headroom checks.
- The route handlers are never refactored, so this work cannot break the app.
- The call shapes are already tested by the route tests.

The cost is one local hop per tool call, which is nothing next to a render. Loopback bypasses
Cloudflare, so the 100 MB edge cap does not apply to internal calls.

`server/src/mcp/api.js` exposes `callApi(user, method, path, { body, query })` and turns
non-2xx answers into tool errors with the route's own message (`QUOTA_EXCEEDED` with the hint,
`EMAIL_NOT_VERIFIED`, 404s, validation messages).

### The tool catalogue

One file per feature under `server/src/mcp/tools/`, each exporting an array of
`{ name, title, description, inputSchema, handler(api, input, ctx) }`. `server/src/mcp/registry.js`
registers them all on each fresh `McpServer`. Rules:

- **At most 75 tools** so the catalogue fits in an agent's context (Claude's call: the first
  draft said 60 and listed about 85; the folds below bring it to about 70). Plain
  list/get/create/delete collapses into one `<feature>_project` tool with an `action` field.
  Pipeline steps that only *prepare* a project fold into one `<feature>_step { step }` tool per
  feature (story: `segment | resegment | images`; ambient: `voice | images`; scene script:
  `voice | suggest_shots`). Steps that *start a render or a paid generation* stay separate so
  their descriptions can carry the cost and the wait. Every feature has one `<feature>_cancel`.
- Names are `feature_verb`, snake case. Descriptions say what the step needs before it
  (for example "every scene needs an image before `story_render`"), what it costs (quota bucket,
  paid providers), and roughly how long it takes.
- Every tool that starts slow work returns a **job handle** `{ kind, id }` and the agent waits
  with `jobs_wait`. Nothing blocks in the tool call longer than a few seconds, except
  `jobs_wait` itself.
- Outputs are returned as both `url` (public, playable) and `path` (the server-relative value
  other tools accept, for example a story's audio for `lyric_set_song`).
- Inputs are validated with Zod before the loopback call; the route validates again.

#### Job handle and `jobs_wait`

```
{ kind, id, projectId?, status: "queued"|"running"|"done"|"failed"|"cancelled",
  percent, phase, output: { url, path } | null, error: string | null }
```

`jobs_wait { kind, id, projectId?, timeoutSec ≤ 90 }` polls the matching status route every
3 seconds and returns the latest handle when the job ends or the timeout passes. The cap is
90 seconds because Hermes defaults to 120 seconds per tool call; the agent simply calls again.
`projectId` is present on kinds whose status route is nested under a project. One normaliser
per kind in `server/src/mcp/jobs.js` maps each feature's status shape onto the handle:

| kind | status route |
|---|---|
| `job` (queue worker: shorts render, waveform, auto-publish campaign) | `GET /api/jobs/:id` |
| `captioned` | `GET /api/render/captioned-video-status/:jobId` |
| `story` (process, render, and AI scene animation) | `GET /api/story/:id` (status, `render.percent`, animation state) |
| `ambient` | `GET /api/ambient/:id` |
| `lyric_align` | `GET /api/lyric-video/:id` (the project's saved timing state; the align route answers 202 and has no job route of its own) |
| `lyric_render` (`projectId` + render job id) | `GET /api/lyric-video/:projectId/render/:jobId` |
| `moments` | `GET /api/moments/:id` |
| `timeline` | `GET /api/timeline/render/:jobId` |
| `scene` (voicing, shots, render) | `GET /api/scene-script/:id` (its derived voicing / shots / render state) |
| `longform` | `GET /api/story/:id` (narration progress) |
| `instrumental` | `GET /api/music/instrumental/:jobId` |
| `publish` | `GET /api/social/youtube/publish/:jobId` |

Every tool that starts work names the `kind` (and `projectId` when needed) in its result, so the
agent never has to work it out.

#### Catalogue by feature (tool → existing route)

The builder reads each route's body shape and Zod validator (`server/src/lib/validators.js` and
the route file) and mirrors it; the shapes are not retyped here.

**Account and system**

| Tool | Route |
|---|---|
| `whoami` | `GET /api/auth/me` + `GET /api/billing/usage` (plan, quota remaining per bucket) |
| `capabilities` | `GET /api/health` booleans + `GET /api/music/capabilities` + `GET /api/video-gen/status` |

**Jobs and media**

| Tool | Route |
|---|---|
| `jobs_list` / `jobs_get` / `jobs_retry` | `GET /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/:id/retry` |
| `jobs_wait` | polling, see above |
| `media_list { kind: audio\|video }` | `GET /api/media/audio-list`, `GET /api/media/video-list` |
| `media_import_url { url, kind, filename }` | **new** `POST /api/media/import-url`: the server downloads the file into the user's media, the same place an upload lands. `lib/downloadInput.js` today has no size cap, no content sniffing, follows redirects freely and does no address check, so it gains: a byte cap from `MAX_INPUT_MB` (moved out of `routes/jobs.js` into `lib/backgroundLimits.js` or a sibling and exported), at most 3 redirects with each hop re-checked, DNS resolved once and the connection pinned to that address, private / loopback / link-local ranges refused, and the existing `imageSniff` / ffprobe check before the file is accepted |
| `media_trim` | `POST /api/media/trim` |
| `transcribe` | `POST /api/transcribe` |

**Scripts and Bible**

| Tool | Route |
|---|---|
| `scripts_generate` | `POST /api/scripts/generate` (`GenerateScriptsSchema`) |
| `bible_lookup` | `GET /api/bible/...` (builder reads the route) |

**Voice and audio**

| Tool | Route |
|---|---|
| `voice_list` | `GET /api/tts/voices`, `GET /api/tts/providers`, `GET /api/tts/profiles` |
| `voice_synthesize { text, voiceId?, provider? }` | `POST /api/tts/auto`, or `POST /api/tts/<provider>` when `provider` is given (elevenlabs, edge, azure, chatterbox, fish, piper) |
| `voice_clone` | `POST /api/tts/clone-voice` |
| `audio_process` | `POST /api/audio/process` |
| `audio_advanced` | `/api/audio-adv` (builder reads the route) |
| `transcripts { action: list\|add\|remove }` | `/api/transcripts` |
| `music_library` | `GET /api/music/library` |
| `music_remove_vocals` / status via `jobs_wait kind=instrumental`; `music_instrumental_decide { keep\|discard }` | `POST /api/music/:id/instrumental`, `POST /api/music/instrumental/:jobId/keep|discard` |

**Backgrounds, library, generated visuals**

| Tool | Route |
|---|---|
| `backgrounds_search { source: pexels\|pixabay, query, ... }` | the Pexels / Pixabay search routes |
| `library_items { action: list\|add\|remove\|categories }` | `/api/library` |
| `images_generate` | `POST /api/imagegen/generate` |
| `visual_library { action: list\|similar\|import\|update\|remove }` | `/api/visual-library` (super-admin only on master; the tool says so) |
| `branding { action: get\|set }` | `GET/PUT /api/branding` |

**Shorts render (Studio → Render)**

| Tool | Route |
|---|---|
| `render_short` | `POST /api/jobs/enqueue` type `render_video` → `kind: job` |
| `render_captioned` / `render_cancel` | `POST /api/render/captioned-video` → `kind: captioned`; `POST .../captioned-video/:jobId/cancel` |

**Story video**

| Tool | Route |
|---|---|
| `story_project { action: list\|get\|create\|delete, ... }` | `/api/story` |
| `story_characters` | `GET /api/story/characters` |
| `story_import_script { script, audioPath, durationMs, ... }` | `POST /api/story/import-script` |
| `story_process { id, mediaPath }` (transcribe → segment → images) | `POST /api/story/:id/process` → `kind: story` |
| `story_step { id, step: segment\|resegment\|images }` | the matching `:id` routes |
| `story_scene_update { id, sceneId, prompt?, regenerate? }` | `PATCH /api/story/:id/scenes/:sid`, `POST .../regenerate` |
| `story_settings { id, captions?, music?, cast? }` | `PATCH /api/story/:id/captions`, `/music`, `/cast` |
| `story_render` / `story_cancel` | `POST /api/story/:id/render`, `/cancel` → `kind: story` |
| `story_animate { id, sceneIds?, estimateOnly? }` (AI scenes; super-admin; paid per clip) | `/api/story/:id/animate`, `/animate/estimate` → `kind: story`; `story_cancel { what: render\|animate }` covers `/cancel` and `/animate/cancel` |

**Ambient session**

| Tool | Route |
|---|---|
| `ambient_project { action: list\|get\|create\|delete }` | `/api/ambient` |
| `ambient_plan` | `POST /api/ambient/:id/plan` |
| `ambient_step { id, step: voice\|images }` | `POST /api/ambient/:id/voice`, `/images` |
| `ambient_update { id, section: drops\|bed\|motion\|words\|captions, patch }` | the matching `PATCH` routes |
| `ambient_render` / `ambient_cancel` | `POST /api/ambient/:id/render`, `/cancel` → `kind: ambient` |
| `ambient_published` | `POST /api/ambient/:id/published` |

**Lyric video**

| Tool | Route |
|---|---|
| `lyric_project { action: list\|get\|create\|delete }` | `/api/lyric-video` |
| `lyric_set_song { id, path }` (a file from `media_import_url` or `media_list`) | `POST /api/lyric-video/:id/song` |
| `lyric_set_lyrics { id, sheet }` | `PUT /api/lyric-video/:id/sheet` |
| `lyric_align` | `POST /api/lyric-video/:id/align` → `kind: lyric_align` |
| `lyric_line_update` | `PATCH /api/lyric-video/:id/lines/:lineId` |
| `lyric_background`, `lyric_render` → `kind: lyric_render` with `projectId`, `lyric_renders` | the remaining routes past line 522 of `lyricVideo.js` (builder reads them) |

**Moments**

| Tool | Route |
|---|---|
| `moments_meta` | `GET /api/moments/meta` |
| `moments_project { action: list\|get\|create\|update\|delete }` | `/api/moments` |
| `moments_statements` / `moments_voiceover` | `POST /api/moments/:id/statements`, `/voiceover` |
| `moments_render` / `moments_cancel` | `POST /api/moments/:id/render`, `/cancel` → `kind: moments` |

**Timeline**

| Tool | Route |
|---|---|
| `timeline_project { action: list\|get\|save }` | `/api/timeline/projects` |
| `timeline_render { project\|projectId, quality, captions... }` | `POST /api/timeline/render` → `kind: timeline` |

**Scene script** (super-admin only, as the routes are)

| Tool | Route |
|---|---|
| `scene_script_parse` | `POST /api/scene-script/parse` |
| `scene_script_project { action: list\|get\|create\|update\|delete }` | `/api/scene-script` |
| `scene_script_step { id, step: voice\|suggest_shots }` | `POST .../:id/voice` (→ `kind: scene`), `/suggest-shots` |
| `scene_script_shots { id, estimateOnly? }` (paid per clip) | `POST .../:id/shots`, `/shots/estimate` → `kind: scene` |
| `scene_script_render` | `POST .../:id/render` → `kind: scene` |
| `scene_script_cancel { id, what: shots\|render }` | `/shots/cancel`, `/render/cancel` |

**Series, long-form, Gumroad, queue**

| Tool | Route |
|---|---|
| `series_preview` / `series_generate` / `series_list` | `/api/series` |
| `longform_templates` / `longform_draft` / `longform_sections` / `longform_narrate` / `longform_reopen` | `/api/longform` → `kind: longform` |
| `gumroad_generate` / `gumroad_history` | `POST /api/gumroad/generate`, `GET /api/gumroad/history` (download zip returned as a URL) |
| `queue_items { action: list\|add\|remove\|clear }` | `/api/queue` |

**Publishing**

| Tool | Route |
|---|---|
| `social_status` | `GET /api/social/youtube/status`, `/auto-publish-status`, `/config` |
| `publish_youtube` | `POST /api/social/youtube/publish` → `kind: publish` |
| `publish_post { destination: tiktok\|webhook\|..., ... }` | `POST /api/social/post` |
| `youtube_thumbnail` | `POST /api/social/youtube/thumbnail` |
| `schedules { action: list\|create\|remove }` | `/api/social/schedules` |
| `autopublish_run` (the Home page's one-click chain) | `POST /api/jobs/enqueue` type `campaign_auto_post` → `kind: job` |

That is about 70 tools. Anything that would push past 75 folds into an existing `action` or
`step` tool.

### Resources and prompts

- Resource `biblefuel://guide`: the end-to-end guide (`docs/mcp.md`, see "Documentation"
  below), so agents without a system prompt still find their way.
- Resource template `biblefuel://jobs/{kind}/{id}`: the job handle, for clients that prefer
  resources to polling tools.
- Prompts `make_short_from_verse`, `make_ambient_session`, `make_lyric_video`: canned
  step lists that call the tools in order. Prompts and resources are the last slice.

### Settings: "Connected agents" card

On the Settings page, after Plan and usage:

- Lists the user's keys: name, created, last used, the "may publish" switch, today's cap usage;
  a Revoke button per row with a confirm; a "Recent activity" view and CSV export.
- "Create key" asks for a name, then shows the key once in a copy field with the warning that it
  will not be shown again.
- Shows the endpoint URL and three copy-ready snippets, each with the placeholder
  `<your key>` (the page never injects a real key):

  Hermes Agent (`~/.hermes/config.yaml`):
  ```yaml
  mcp_servers:
    biblefuel:
      url: "https://biblefuel.tiwaton.co.uk/api/mcp"
      headers:
        Authorization: "Bearer <your key>"
      timeout: 120
  ```
  Codex (`~/.codex/config.toml`, key in the `BIBLEFUEL_AGENT_KEY` environment variable):
  ```toml
  [mcp_servers.biblefuel]
  url = "https://biblefuel.tiwaton.co.uk/api/mcp"
  bearer_token_env_var = "BIBLEFUEL_AGENT_KEY"
  ```
  Claude Code:
  ```bash
  claude mcp add --transport http biblefuel https://biblefuel.tiwaton.co.uk/api/mcp --header "Authorization: Bearer ${BIBLEFUEL_AGENT_KEY}"
  ```
- The endpoint URL comes from the server (`GET /api/agent-keys` returns `endpoint`), built from
  the request host, so a dev server shows `http://localhost:5051/api/mcp`.
- Follows the product design system: existing `Card`, buttons and inputs; no new styles.

### Publishing needs the key owner's consent

Publishing tools (`publish_youtube`, `publish_post`, `youtube_thumbnail`, `schedules`,
`autopublish_run`) run only on a key whose owner switched on **"This key may publish"**.
The switch is off when a key is created; the owner turns it on in the Connected agents card
(or at creation, where the label spells out that the agent will post to connected accounts as
them), and the change is written to the activity log. On a key without consent the publish
tools are still listed, so an agent can plan, but they refuse with
`PUBLISH_NOT_ALLOWED: the key's owner has not allowed publishing. Ask them to switch it on in
Settings → Connected agents`, and nothing is uploaded or scheduled. Per-item approval (the
owner confirming each post from the app's notification bell) is noted under "Later".

### Every feature, enforced by a test

The catalogue is meant to cover everything a user can do in the app. So that nothing is
forgotten as features land, `server/src/mcp/coverage.test.js` walks every router mounted under
`/api` in `index.js` and fails when one has no tool mapped to it, unless it is on the explicit
exclusion list: `auth`, `agent-keys`, `admin`, `access-requests`, `billing` (except `usage`),
`stems-worker`, `firebase`, `abi`, `postiz` (parked), `issues`. A new router therefore needs
either a tool or a reasoned entry on that list. Routers the first draft left out and that get
tools: `audio-adv` (`audio_advanced`), `transcripts` (`transcripts { action: list|add|remove }`),
`story` long-form reopen (`longform_reopen`), and `ambient` "mark as published"
(`ambient_published`).

### Activity log

Every tool call is appended to `DATA_DIR/agent-activity/YYYY-MM-DD.jsonl`, one line per call:
`{ ts, keyId, keyName, userId, email, tool, input (text fields cut to 200 characters, paths
kept, never file bytes or keys), ok, error, ms, job: { kind, id } | null, caps: the buckets
this call counted against }`. Consent switches, key creation and revocation are logged too.
Retention 90 days, pruned on server start.

Who sees it:

- **The owner of a key** sees their own keys' activity in the Connected agents card: the last
  50 calls, and a CSV export of any day range.
- **Super-admins** get an "Agent activity" tab on the Admin page across all users: filter by
  user, key, tool, outcome and date; counts per tool and per user; CSV export. This is the view
  the operator learns from: which tools agents reach for, where they fail, what they never use.

Routes: `GET /api/agent-keys/activity` (own) and `GET /api/admin/agent-activity` (all), both
JWT only, never reachable by a key.

### Plans and roles: a key never gets past its user

The agent is the user, no more. This already follows from the loopback design (every route
keeps its `withUserScope`, `quota`, `featureGate`, `requireVerifiedEmail` and
`requireSuperAdmin` middleware), and the design makes it explicit:

- A free-tier key hits the free-tier daily quotas (`QUOTA_EXCEEDED`), with the daily key caps
  applied on top where they are lower.
- Tools whose route is super-admin only (scene script, AI scene animation, visual library) or
  behind a feature gate (Gumroad) carry a `requires` field in the catalogue, and the registry
  **does not list them** to a key whose user lacks the right, so agents never try. If one is
  called anyway, the route's own 403 reaches the agent unchanged.
- Projects, outputs, library and jobs are the user's own directory; there is no tool that takes
  another user's id.
- Tests: a free-tier key refused at the free render quota; a non-admin key that cannot see or
  call `scene_script_*`; a key that cannot read another user's story by id; a super-admin key
  still refused by its daily cap.

### Daily caps on every key (the operator's rule while usage is being tested)

Plan quotas stay as they are, but they are unlimited for premium and super-admin accounts, so
the MCP layer adds its own brake that applies to **every** key, the owner's included:

- Counters per key per UTC day, kept in `DATA_DIR/agent-keys-usage.json`:
  `renders` (any tool that starts a render), `aiVideoUsd` (AI scene motion, scene-script shots,
  AI music video: the estimate the route returns, added before the call), `images`
  (image generation, story and ambient image steps), `tts` (voice synthesis calls),
  `publishes`.
- Ceilings come from the environment and apply to everyone:
  `MCP_DAILY_RENDERS` (default 10), `MCP_DAILY_AI_VIDEO_USD` (default 2),
  `MCP_DAILY_IMAGES` (default 30), `MCP_DAILY_TTS` (default 30),
  `MCP_DAILY_PUBLISHES` (default 3). The operator raises them in Coolify when testing is over.
- A key's owner can set a *lower* cap per key on the Connected agents card; nobody can set a
  higher one than the environment ceiling.
- A tool that would cross a cap is refused before the loopback call with
  `MCP_CAP_REACHED { bucket, used, limit, resetsAt }`, so no quota tick and no spend happens.
  `whoami` reports the key's remaining caps next to the plan quotas, so a well-behaved agent
  can plan around them.
- The cap check runs after the user's own plan quota check in the chain, never instead of it:
  a free-tier user still gets the free-tier numbers if those are lower.

### Documentation that agents and developers read

One Markdown source, `docs/mcp.md`, written for someone who has never seen BibleFuel. It
covers, in order: what the endpoint is and the URL; getting a key from Settings; connecting
Hermes, Codex and Claude Code (the same snippets as the card); the shape of every tool call and
result; the job handle and how to wait; how media gets in (URL import, or the upload routes with
a worked `curl` example); the pipelines, one per feature, as ordered tool lists (for example
"script → voice → background → render → publish" and "import song → lyrics → align → render");
quotas, daily caps and the errors they produce; what a key can never do; and a troubleshooting
list (401, 403 for scene scripts, `MCP_CAP_REACHED`, timeouts).

The same file is served three ways so it is never out of date in one place:

- in the repository, next to the other docs;
- as the MCP resource `biblefuel://guide`, so an agent can read it before its first call;
- on the app's Help page under "Connect an agent", rendered from the same file at build time.

Each slice updates the sections it touches; a tool is not done until its section exists.

## Security

- Keys are hashed at rest; the plain key exists only in the create response.
- Constant-time hash comparison; unknown, revoked and orphaned keys all return the same 401.
- Per-key rate limit; the loopback JWT lives 60 seconds and is never returned to the agent.
- The catalogue never maps `/api/admin`, `/api/billing` writes, `/api/access-requests`,
  `/api/stems-worker`, `/api/firebase`, or auth routes.
- Path inputs (`mediaPath`, `audioPath`, `path`) are passed through to routes that already confine
  them to the user's outputs; the MCP layer adds no filesystem access of its own.
- `media_import_url` refuses private and loopback addresses, follows at most 3 redirects, caps
  size at `MAX_INPUT_MB`, and sniffs the content type before accepting.
- Agent calls count against the same daily quotas as the app; `QUOTA_EXCEEDED` reaches the agent
  with the route's hint.

## Delivery slices (each a PR, each reviewed by Codex)

1. **Foundation**: `/api/mcp` transport, agent keys (store, routes, auth, the publish consent
   switch), daily caps, the activity log, loopback `callApi`, `whoami`, `capabilities`, jobs
   tools and `jobs_wait` normalisers, `media_*`, the Settings card with its activity view, the
   coverage test with the exclusion list, and the first version of `docs/mcp.md` served as the
   guide resource and on the Help page. The Admin "Agent activity" tab lands in slice 2.
2. **Create**: scripts, Bible, voice and audio, backgrounds and library, images, branding,
   shorts render, publishing, auto-publish.
3. **Story and ambient**: the story video and ambient session tools.
4. **Lyric, moments, timeline, scene script, series, long-form, Gumroad, queue, music**.
5. **Guide, resources, prompts**; then a review of tool descriptions against real agent runs
   (Hermes and Claude Code) and trimming of anything agents never use.

## Testing

- Unit (`node --test`): key generation and hashing; store revoke and limit; constant-time
  verify; every `jobs_wait` normaliser against fixture status payloads; `callApi` error
  mapping; the `media_import_url` address and size refusals; the daily cap counter (rollover at
  midnight UTC, refusal before the call, a lower per-key cap winning over the environment
  ceiling, a super-admin key still capped).
- Integration (`supertest` + the SDK's own client over Streamable HTTP against the Express app):
  `initialize`, `tools/list`, a `tools/call` that reaches a real route (for example
  `scripts_generate` with the generator mocked), a revoked key, a JWT, a quota refusal
  surfacing as a tool error, and a super-admin-only tool refused for a normal user.
- Client (`vitest`): the Connected agents card creates, shows once, revokes, and renders the
  three snippets without a key in them.
- Manual: Hermes Agent and Claude Code connected to the dev server; one story short made end to
  end by an agent, then the same on production.

## Later (not in these slices)

- OAuth 2.1 (authorization code with PKCE, dynamic client registration) so claude.ai custom
  connectors and Claude Desktop can connect without a pasted key.
- Per-item publish approval: a publish from a key without consent lands in the owner's
  notification bell to approve or reject, instead of being refused.
- Finer scopes on keys (read-only, one feature only) if keys are shared with other people.
- Server-sent notifications for job progress once clients use them.

## Left to the builder

- The exact Zod shape of every tool input, read from each route and validator.
- The SDK's current constructor options and Express wiring (`examples/` in the SDK repository),
  and whether `enableDnsRebindingProtection` needs the proxied host added.
- The `media_import_url` route placement in `media.js` and its reuse of `downloadInput.js`.
- Choosing which status fields each normaliser reads, from the route files.
- Where in `index.js` the MCP router mounts relative to the JSON body parser (the SDK transport
  accepts a pre-parsed body; pass `req.body` to `handleRequest`).

## Sources checked for the client snippets

- Hermes Agent MCP docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp
- Codex MCP docs: https://developers.openai.com/codex/mcp
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
