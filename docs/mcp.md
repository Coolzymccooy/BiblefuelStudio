# Connect an agent to BibleFuel

Give an AI agent a key, and it can drive BibleFuel Studio for you: find your media, transcribe it, start renders and wait for them to finish.

## What it is

BibleFuel runs a Model Context Protocol (MCP) server. An agent connects to one URL and gets a list of tools. Each tool does one thing you can already do in the app.

- Endpoint: `https://biblefuel.tiwaton.co.uk/api/mcp`
- Transport: Streamable HTTP. Send `POST` requests only. `GET` and `DELETE` answer 405.
- Authentication: `Authorization: Bearer bfk_...` header. Keys in a query string are never accepted.
- Identity: the agent acts as you. It gets your plan, your quotas and your files, and nothing more.
- Rate limit: 120 requests per minute per key. Past that you get HTTP 429 with `RATE_LIMITED`.
- Guide: this document is also the MCP resource `biblefuel://guide`, so an agent can read it before its first call.

## Get a key

1. Sign in to BibleFuel and open **Settings**, then **Connected agents**.
2. Choose **Create key** and give it a name, for example `hermes laptop`.
3. Copy the key now. It starts with `bfk_` and is shown once. BibleFuel stores only a hash, so a lost key cannot be recovered. Revoke it and create another.

Good to know:

- You can hold 10 live keys. Revoke a key on the same card; it stops working at once.
- **This key may publish** is off for a new key. Turn it on only for an agent you trust to post to your connected accounts as you.
- Each key can have lower daily caps than the server default. You can lower them. You cannot raise them.
- Never paste a key into a chat, a repository or a shared config. Use an environment variable.

## Connect Hermes Agent

Add this to `~/.hermes/config.yaml`. Replace `<your key>` with your key.

```yaml
mcp_servers:
  biblefuel:
    url: "https://biblefuel.tiwaton.co.uk/api/mcp"
    headers:
      Authorization: "Bearer <your key>"
    timeout: 120
```

The 120 second timeout is longer than the longest wait a tool makes (90 seconds), so a wait never times out on the Hermes side.

`hermes config path` prints where the config file lives. On Windows it is `%LOCALAPPDATA%\hermes\config.yaml`, not `~/.hermes`. You can also add the server from the command line, and Hermes prompts for the header: `hermes mcp add biblefuel --url https://biblefuel.tiwaton.co.uk/api/mcp --auth header`.

## Connect Codex

Add this to `~/.codex/config.toml`. Put your key in the `BIBLEFUEL_AGENT_KEY` environment variable. Codex reads the variable named by `bearer_token_env_var` and sends it as the bearer token.

```toml
[mcp_servers.biblefuel]
url = "https://biblefuel.tiwaton.co.uk/api/mcp"
bearer_token_env_var = "BIBLEFUEL_AGENT_KEY"
```

## Connect Claude Code

Export your key, then add the server:

```bash
export BIBLEFUEL_AGENT_KEY="<your key>"
claude mcp add --transport http biblefuel https://biblefuel.tiwaton.co.uk/api/mcp --header "Authorization: Bearer ${BIBLEFUEL_AGENT_KEY}"
```

Any other MCP client works too. Point it at the endpoint with the bearer header.

To check the connection, ask the agent to call `whoami`. It should answer with your email, your plan and the key's name.

## How a call works

Every tool takes a JSON object and returns two copies of the same result: `structuredContent` (an object) and a text block holding that object as JSON. Read whichever your client exposes.

A success looks like this (`whoami`, shortened):

```json
{
  "user": { "id": "u_123", "email": "you@example.com", "role": "user", "isSuperAdmin": false, "emailVerified": true },
  "plan": "free",
  "quota": { "render": { "used": 1, "limit": 5, "unlimited": false, "remaining": 4 } },
  "caps": { "renders": { "used": 1, "limit": 10, "remaining": 9 } },
  "key": { "id": "k_abc", "name": "hermes laptop", "publishAllowed": false }
}
```

A failure has `isError: true`. The text block reads `CODE: message`, and `structuredContent` holds the same as an object:

```json
{ "error": "MCP_CAP_REACHED", "message": "Daily renders cap reached for this agent (10 of 10).", "bucket": "renders", "used": 10, "limit": 10, "resetsAt": "2026-10-24T00:00:00.000Z" }
```

Branch on the `CODE`, not on the message. Errors that come from the app's own routes also carry `hint` (what to do) and `status` (the HTTP status).

Every call passes the same checks, in this order:

1. Publish consent, for publishing tools only.
2. Daily caps. A refused call costs nothing.
3. The tool itself, which calls the app as you, so your plan quotas and permissions apply.
4. The activity log entry.

### Tools available today

| Tool | What it does |
|---|---|
| `whoami` | Who you act as, your plan, remaining quota, the key's daily caps and publish permission. Call it first. |
| `capabilities` | What this server can do right now: ffmpeg, which providers are configured, vocal removal, AI video. |
| `media_list` | `{ kind: "audio" or "video" }`. Your files, newest first, each with `name`, `path`, `size`, `mtime`. |
| `media_import_url` | `{ url, kind?, filename? }`. Download a public file into your media. `kind` is `audio` (default), `video` or `image`. |
| `media_trim` | `{ inputPath, startSec, endSec }`. Cut a file into a new file. The original stays. |
| `transcribe` | `{ mediaPath }`. Words with `startMs` and `endMs`, plus `durationMs`. Counts against your daily render quota. |
| `jobs_list` | `{ limit? }`. Your recent queued render jobs, newest first. |
| `jobs_get` | `{ id }`. One queued job as a job handle. |
| `jobs_retry` | `{ id }`. Re-queue a finished or failed job. Returns a new job. Counts as one render. |
| `jobs_wait` | `{ kind, id, projectId?, timeoutSec? }`. Wait for any background job. See the next section. |

More tools arrive in later slices. The Pipelines section shows where each fits.

## Waiting for jobs

Anything slow returns a **job handle** immediately and keeps working in the background. You never wait inside the tool that started it. Use `jobs_wait`.

```json
{
  "kind": "job",
  "id": "job_ab12cd",
  "status": "running",
  "percent": 42,
  "phase": null,
  "output": null,
  "error": null
}
```

- `status` is one of `queued`, `running`, `done`, `failed`, `cancelled`. Stop when it is `done`, `failed` or `cancelled`.
- `percent` is 0 to 100, or `null` when the job does not report progress.
- `output` is `{ url, path }` when there is a file. `url` is public and playable. `path` is the server-side value you pass to other tools.
- `error` is a short message when `status` is `failed`.
- `kind` says which status route to read. The kinds are `job`, `captioned`, `story`, `timeline`, `instrumental` and `publish`. Every tool that starts work tells you the `kind` to use. For `story`, pass the project id as `id`.

Call `jobs_wait`:

```json
{ "kind": "job", "id": "job_ab12cd", "timeoutSec": 60 }
```

`jobs_wait` checks every 3 seconds. It returns as soon as the job ends, or when `timeoutSec` passes. `timeoutSec` is 1 to 90 and defaults to 60. It is capped at 90 because many agents give up on a tool call after 120 seconds.

If the handle still says `queued` or `running`, call `jobs_wait` again with the same arguments. A render can take many minutes, so a long job needs several calls. That is normal.

An unknown `kind` returns `BAD_KIND` and lists the valid ones.

## Getting media in

Tools take a **server-side path**, not a file. Get a file onto the server, then pass the path it returns.

### From a public URL

Use `media_import_url`. The server downloads the file into your media, the same place an upload lands.

```json
{ "url": "https://example.com/sermon.mp3", "kind": "audio" }
```

The result includes `file` (the path to pass on, for example to `transcribe` as `mediaPath`) and `mime`.

The server refuses addresses it should not fetch. These errors reach you as tool errors, with the HTTP status in `status`:

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_URL` | 400 | `url` is missing, not a string, or too long. |
| `INVALID_KIND` | 400 | `kind` is not `audio`, `video` or `image`. |
| `INVALID_FILENAME` | 400 | `filename` is not a string of 200 characters or fewer. |
| `URL_SCHEME` | 400 | Only `http` and `https` are allowed. |
| `URL_PRIVATE` | 400 | The address is private, local or otherwise not public. |
| `URL_REDIRECTS` | 400 | More than 3 redirects. |
| `URL_TOO_LARGE` | 413 | Over the size limit (200 MB by default). |
| `URL_TIMEOUT` | 504 | The download stalled or took too long. |
| `DOWNLOAD_FAILED` | 502 | The remote server refused or the file could not be fetched. |
| `IMPORT_FAILED` | 500 | The server hit an unexpected error while importing. Try once more. |

A file you already uploaded in the app is in `media_list`. You do not need to import it again.

### From your own machine

For most people the way to get a local file in is to host it at a public URL and use `media_import_url` above.

A developer can also upload directly. An agent key works at `/api/mcp` only, so this uses a sign-in token (a JWT) against the upload route. The example below signs in with email and password, which works only for an account that has a local password (a self-hosted or dev account). Accounts that sign in with Google or Firebase have no local password and get `Invalid credentials`; they should use `media_import_url`. The login route is limited to 25 requests per 15 minutes.

Send the file as the request body, with its real `Content-Type`, and its name in `?filename=`.

```bash
# 1. Sign in to get a token (local-password accounts only)
TOKEN=$(curl -s -X POST https://biblefuel.tiwaton.co.uk/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your password"}' | jq -r .token)

# 2. Upload the audio
curl -X POST "https://biblefuel.tiwaton.co.uk/api/media/upload-audio?filename=sermon.mp3" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: audio/mpeg" \
  --data-binary @sermon.mp3
```

The answer is `{ "ok": true, "file": "<server path>", "mime": "audio/mpeg" }`. Pass `file` to the tools as `mediaPath` or `inputPath`.

The public host sits behind a proxy that rejects bodies over 100 MB. For a larger file, host it somewhere public and use `media_import_url`.

## Pipelines

Each pipeline is an ordered list of tools. Tools marked **coming** are planned and are not in the server yet: a tool that is not in `tools/list` does not exist, so do not call it. Call `whoami` and `capabilities` before any pipeline.

### Media: import, transcribe, trim (available now)

1. `media_import_url` (or `media_list` to reuse a file)
2. `transcribe` (words and timings)
3. `media_trim` (optional: cut a new file by seconds)
4. A render tool, then `jobs_wait`. Render tools are **coming**.

Stuck or finished jobs: `jobs_list`, `jobs_get`, `jobs_retry`, then `jobs_wait`.

### Short video from a Bible verse (coming)

`bible_lookup` or `scripts_generate`, then `voice_synthesize`, then `backgrounds_search`, then `render_short`, then `jobs_wait`, then `publish_youtube` (needs publish consent).

### Scripts (coming)

`scripts_generate`, `bible_lookup`.

### Voice (coming)

`voice_list`, `voice_synthesize`, `voice_clone`, `audio_process`, `audio_advanced`, `transcripts`.

### Backgrounds and images (coming)

`backgrounds_search`, `library_items`, `images_generate`, `visual_library`.

### Story video (coming)

`story_project`, `story_import_script` or `story_process`, `story_step` (segment, resegment, images), `story_scene_update`, `story_settings`, `story_render`, `jobs_wait` with `kind: "story"`. Optional AI motion: `story_animate`.

### Ambient session (coming)

`ambient_project`, `ambient_plan`, `ambient_step` (voice, images), `ambient_update`, `ambient_render`, `jobs_wait`, `ambient_published`.

### Lyric video (coming)

`lyric_project`, `lyric_set_song` (a path from `media_import_url`), `lyric_set_lyrics`, `lyric_align`, `lyric_line_update`, `lyric_background`, `lyric_render`, `jobs_wait`.

### Moments (coming)

`moments_meta`, `moments_project`, `moments_statements`, `moments_voiceover`, `moments_render`, `jobs_wait`.

### Gumroad (coming)

`gumroad_generate`, `gumroad_history`. Needs the Gumroad feature on your plan.

### Timeline (coming)

`timeline_project`, `timeline_render`, `jobs_wait` with `kind: "timeline"`.

### Scene script (coming)

`scene_script_parse`, `scene_script_project`, `scene_script_step` (voice, suggest shots), `scene_script_shots`, `scene_script_render`, `jobs_wait`. Super-admin accounts only.

### Series (coming)

`series_preview`, `series_generate`, `series_list`.

### Long-form (coming)

`longform_templates`, `longform_draft`, `longform_sections`, `longform_narrate`, `longform_reopen`.

### Queue (coming)

`queue_items` with `action` of `list`, `add`, `remove` or `clear`.

### Music (coming)

`music_library`, `music_remove_vocals`, `jobs_wait` with `kind: "instrumental"`, `music_instrumental_decide`.

### Branding (coming)

`branding` with `action` of `get` or `set`.

### Publishing (coming)

`social_status`, `publish_youtube`, `publish_post`, `youtube_thumbnail`, `schedules`, `autopublish_run`. All of them except `social_status` need the key owner's consent (see below).

## Quotas and daily caps

Two limits apply, and the lower one wins.

**Your plan quota.** The same daily quotas the app uses. A free account hits free limits. When you pass one, the call fails with `QUOTA_EXCEEDED` and a `hint`. `whoami` shows what is left in `quota` (buckets `scripts`, `tts`, `render` and `imageGen`; premium and admin accounts are unlimited).

**The daily agent caps.** Every key has its own counters, and they apply to every account, premium and admin included. They reset at midnight UTC.

| Bucket | What counts | Default per key per day |
|---|---|---|
| `renders` | Tools that start a render | 10 |
| `aiVideoUsd` | AI video: the estimated cost in US dollars | 2 |
| `images` | Image generation | 30 |
| `tts` | Voice synthesis calls | 30 |
| `publishes` | Publishing calls | 3 |

A call that would cross a cap is refused before anything runs, so nothing is spent. The error is `MCP_CAP_REACHED` with `bucket`, `used`, `limit` and `resetsAt` (an ISO time, the next midnight UTC). Stop, tell the user, and retry after `resetsAt`.

`whoami` returns `caps` with `used`, `limit` and `remaining` for each bucket. Read it before starting a long plan. The server operator sets the ceilings with `MCP_DAILY_RENDERS`, `MCP_DAILY_AI_VIDEO_USD`, `MCP_DAILY_IMAGES`, `MCP_DAILY_TTS` and `MCP_DAILY_PUBLISHES`. The key owner can set lower numbers for one key.

## What a key can never do

- **Go past its user.** A key has exactly the plan, role and files of the person who made it. A tool that needs a role the user lacks is not listed. Projects, outputs and jobs belong to that one user, and no tool takes another user's id.
- **Publish without consent.** Publishing tools are listed but refuse until the owner switches on **This key may publish**. They fail with `PUBLISH_NOT_ALLOWED` and upload or schedule nothing.
- **Manage the account.** A key cannot delete the account, create or revoke keys, change the plan, open checkout or the billing portal, use admin routes or file access requests. These fail with `AGENT_FORBIDDEN`.
- **Reach private networks.** `media_import_url` refuses private, local and non-http addresses, follows at most 3 redirects and enforces a size limit.
- **Skip the caps.** The daily caps apply to everyone.
- **Hide.** Every tool call is written to an activity log: time, key, tool, a trimmed copy of the input (text is cut to 200 characters, secret fields are dropped, file bytes are never kept), whether it worked, how long it took, the job it started and the caps it used. Key creation, revocation and consent changes are logged too. Entries are kept 90 days. You see your own keys' recent calls on **Settings, Connected agents**, and can export them as CSV.

## Troubleshooting

| You see | Cause | Fix |
|---|---|---|
| HTTP 401, `AGENT_KEY_INVALID` | The key is wrong, revoked, or its owner no longer exists. All three look the same on purpose. | Check you copied the whole key. Create a new one in Settings. |
| HTTP 401, `Missing Bearer token` or `Invalid token` | No `Authorization` header, or it is not `Bearer <key>`. | Send the header. Keys in the URL are ignored. |
| Tool error `AGENT_FORBIDDEN` (`status` 403) | A key reached a route that keys may never use (account, billing, admin). | Do that in the app yourself. |
| Tool error with `status` 403 from the app | The user's plan or role does not allow it, for example a scene script on a non-admin account. | Use an account that has the right. The tool is normally not listed without it. |
| HTTP 403 on the connection itself, before any tool runs | The `Host` header is not on the allowed list. This is the usual symptom when you reach the server through a tunnel such as ngrok. | Add the tunnel host name to `MCP_ALLOWED_HOSTS` on the server (comma separated). |
| HTTP 405 | A `GET` or `DELETE` to `/api/mcp`. | Use `POST`. |
| HTTP 429, `RATE_LIMITED` | More than 120 requests a minute on one key. | Wait a minute. Use `jobs_wait` rather than polling in a loop. |
| `PUBLISH_NOT_ALLOWED` | The key's owner has not allowed publishing. | Ask them to switch on **This key may publish** in Settings, Connected agents. |
| `MCP_CAP_REACHED` | A daily cap is used up. | Read `bucket` and `resetsAt`. Wait for the reset, or ask the owner to raise the server ceiling. |
| `QUOTA_EXCEEDED` | The account's own plan quota is used up. | Wait for the daily reset or change plan in the app. |
| `BAD_KIND` | `jobs_wait` got a `kind` it does not know. | Use the `kind` the starting tool returned. |
| `INVALID_URL`, `INVALID_KIND`, `INVALID_FILENAME`, `URL_PRIVATE`, `URL_SCHEME`, `URL_REDIRECTS`, `URL_TOO_LARGE`, `URL_TIMEOUT`, `DOWNLOAD_FAILED`, `IMPORT_FAILED` | `media_import_url` could not fetch the file. | See the table under Getting media in. |
| The tool call times out in the client | The client gave up before `jobs_wait` returned. | Lower `timeoutSec`, or raise the client timeout above 90 seconds (Hermes: `timeout: 120`). The job keeps running; call `jobs_wait` again. |
| A job is `running` for a long time | Renders are slow and queue behind other work. | Keep calling `jobs_wait`. If `status` becomes `failed`, read `error`, then try `jobs_retry`. |
| `INTERNAL` | The server hit an unexpected error. | Try once more, then tell the user. |
