# Connect an agent to BibleFuel

Give an AI agent a key, and it can drive BibleFuel Studio for you: find your media, transcribe it, start renders and wait for them to finish.

## What it is

BibleFuel runs a Model Context Protocol (MCP) server. An agent connects to one URL and gets a list of tools. Each tool does one thing you can already do in the app.

- Endpoint: `https://biblefuel.tiwaton.co.uk/api/mcp`
- Transport: Streamable HTTP. Send `POST` requests only. `GET` and `DELETE` answer 405.
- Authentication: `Authorization: Bearer bfk_...` header, with an agent key only. Keys in a query string are never accepted, and an app sign-in token (a JWT) is refused with `AGENT_KEY_REQUIRED`.
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
- Each key can have lower daily caps than the server default. Open **Daily limits** under the key, change a number and choose **Save limits**. Each number can go from 0 up to the server's ceiling, shown under it; a higher number is saved as the ceiling. You cannot raise a key above it.
- Never paste a key into a chat, a repository or a shared config. Use an environment variable.

## Connect Hermes Agent

Add this to your Hermes `config.yaml` (run `hermes config path` to find it: `~/.hermes/config.yaml` on macOS and Linux, `%LOCALAPPDATA%\hermes\config.yaml` on Windows). Replace `<your key>` with your key.

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
  "accountCaps": { "renders": { "used": 3, "limit": 10, "remaining": 7 } },
  "key": { "id": "k_abc", "name": "hermes laptop", "publishAllowed": false }
}
```

A failure has `isError: true`. The text block reads `CODE: message`, and `structuredContent` holds the same as an object:

```json
{ "error": "MCP_CAP_REACHED", "message": "Daily renders cap reached for this agent (10 of 10).", "bucket": "renders", "scope": "key", "used": 10, "limit": 10, "resetsAt": "2026-10-24T00:00:00.000Z" }
```

Branch on the `CODE`, not on the message. Errors that come from the app's own routes also carry `hint` (what to do) and `status` (the HTTP status).

Every call passes the same checks, in this order:

1. Publish consent, for publishing tools only.
2. Daily caps. A call a cap refuses costs nothing. When the app then refuses the call itself (an HTTP 4xx answer: a used-up plan quota, an input it rejects, an account that is not connected), the caps that call spent are given back, except `imports` (an import attempt always counts). A server error (5xx) or a dropped connection keeps the charge, because the work may have started.
3. The tool itself, which calls the app as you, so your plan quotas and permissions apply.
4. The activity log entry.

### Tools available today

| Tool | What it does |
|---|---|
| `whoami` | Who you act as, your plan, remaining plan `quota`, this key's daily `caps`, your account's `accountCaps` (all your keys together) and the publish permission. Call it first. |
| `capabilities` | What this server can do right now: ffmpeg, which providers are configured, vocal removal, AI video. |
| `media_list` | `{ kind: "audio" or "video" }`. Your files, newest first, each with `name`, `path`, `size`, `mtime`. |
| `media_import_url` | `{ url, kind?, filename? }`. Download a public file into your media. `kind` is `audio` (default), `video` or `image`. One daily `imports`, spent even when the download fails. |
| `media_trim` | `{ inputPath, startSec, endSec }`. Cut a file into a new file. The original stays. |
| `transcribe` | `{ mediaPath }`. Words with `startMs` and `endMs`, plus `durationMs`. Counts against your daily render quota. |
| `jobs_list` | `{ limit? }`. Your recent queued render jobs, newest first. |
| `jobs_get` | `{ id }`. One queued job as a job handle. |
| `jobs_retry` | `{ id }`. Re-queue a finished or failed job. Returns a new job. One daily render. A render (`render_video`, `render_waveform`) or posting job (`campaign_auto_post`) also spends one plan `render` quota (`QUOTA_EXCEEDED` before any cap is spent). A posting job needs publish consent and also costs one daily publish; a render that the user's auto-publish would post costs one daily publish with consent, and without consent is queued so it never posts. |
| `jobs_wait` | `{ kind, id, projectId?, timeoutSec? }`. Wait for any background job. See the next section. |
| `scripts_generate` | Short Bible video scripts (hook, verse, reflection, call to action, hashtags). Every field optional. Counts against the plan's `scripts` quota. |
| `bible_lookup` | `{ mode: "verse" or "parse" or "translations", reference?, translation? }`. Verse text, reference parsing, or the translation list. Free. |
| `voice_list` | `{ provider? }`. Voices of one provider (`edge` by default, or `elevenlabs`), every provider's status, the voice profiles and your cloned voices. |
| `voice_synthesize` | `{ text, voiceId?, provider? }`. Text to speech. Returns `path` and `url`. One daily `tts` call. |
| `voice_clone` | `{ name, samplePaths, consent, provider? }`. Clone a voice from files in your media. Premium plans. One daily `tts` call. |
| `transcripts` | `{ action: "list" or "add" or "remove", ... }`. Your saved, edited transcripts. |
| `audio_process` | `{ inputPath, preset?, ... }`. Clean up an audio file into a new mp3: trim, loudness, noise, EQ, compressor. |
| `audio_advanced` | `{ action: "merge" or "timeline" or "timeline_preview" or "info", ... }`. Join and arrange clips, preview them over a video, read a length. |
| `music_library` | `{ source? }`. Bundled tracks and your own, each with `id`, `ref`, `durationSec` and licence. |
| `music_remove_vocals` | `{ id, quality? }`. Start vocal removal on a track. Returns a job handle of kind `instrumental`. Takes minutes. One daily render. |
| `music_instrumental_decide` | `{ jobId, decision: "keep" or "discard" }`. Settle a finished (or cancel a running) vocal removal. |
| `backgrounds_search` | `{ source: "pexels" or "pixabay", query, limit? }`. Stock background videos (no photos). Results are not saved yet. |
| `library_items` | `{ action: "list" or "download" or "add" or "remove" or "categories", ... }`. Your saved backgrounds. A library id works as a background in the render tools. `download` is one daily `imports`, spent even when it fails. |
| `images_generate` | `{ lines, aspect?, count? }`. AI stills from text lines. Returns `path` and `url` per image. One daily `images` per image. |
| `visual_library` | `{ action: "list" or "similar" or "import" or "update" or "remove", ... }`. Paid AI clips. Super-admin keys only; other keys do not see it. |
| `branding` | `{ action: "get" or "set", enabled?, position?, size?, opacity? }`. The logo drawn on your rendered videos. |
| `render_short` | `{ lines, backgrounds? or autoBackground?, audioPath?, musicPath?, ... }`. A short captioned video. Job handle of kind `job`. One daily render (plus four `images` with `autoBackground`). |
| `render_captioned` | `{ videoPath }` or `{ audioPath, backgrounds }`, plus `words` from `transcribe`. Word-by-word captions. Handle of kind `captioned`. One daily render and one plan `render` quota. |
| `render_cancel` | `{ id }`. Stop a running `render_captioned` job. |
| `story_project` | `{ action: "list" or "get" or "create" or "delete" or "characters", ... }`. Story video projects; `get` shows the scenes with their pictures and a story job handle; `characters` lists the cast keys. |
| `story_import_script` | `{ script, audioPath, durationMs, words?, autoStart?, ... }`. A story from a written script and its narration. With `autoStart` the pictures are made at once (daily `images`, estimated up front); handle of kind `story`. |
| `story_process` | `{ id, mediaPath }`. Transcribe a recording, cut it into scenes and make the pictures, in the background. Handle of kind `story`. Daily `images` for the pictures, estimated up front. |
| `story_step` | `{ id, step: "segment" or "resegment" or "images", force? }`. One step. `images` costs one daily `images` per picture made; `resegment` deletes every picture and makes new ones. |
| `story_scene_update` | `{ id, sceneId, prompt?, text?, regenerate? }`. Edit a scene; `regenerate` makes a new picture now (one daily `images`, given back if none is made). |
| `story_settings` | `{ id, captions?, music?, cast? }`. Caption mode and look, the music bed (a `music_library` ref or a media file), the cast. |
| `story_render` | `{ id }`. Render the video once every scene has a picture. Handle of kind `story`. One daily render and one plan `render` quota. Never posts. |
| `story_animate` | `{ id, sceneIds?, quality?, estimateOnly? }`. Paid AI motion clips for scenes. Super-admin keys only; the estimate's dollars are charged to the daily `aiVideoUsd` cap first. |
| `story_cancel` | `{ id, what?: "render" or "animate" }`. Stop the pictures or render, or stop ordering AI clips. Free. |
| `ambient_project` | `{ action: "list" or "get" or "create" or "delete" or "mark_published", ... }`. Ambient sessions (long music-first scripture videos); `get` shows the verses, pictures, bed and an ambient job handle; `mark_published` records a YouTube upload (posts nothing). Free. |
| `ambient_plan` | `{ id, count? }`. Suggest verse references for the theme, spaced across the length. Replaces every verse. One plan `scripts` quota. |
| `ambient_step` | `{ id, step: "voice" or "images", force?, movementId? }`. Speak the verses (one daily `tts` per verse) or make the pictures (one daily `images` per picture), charged up front, in the background. Handle of kind `ambient`. |
| `ambient_update` | `{ id, section: "drops" or "bed" or "motion" or "words" or "captions", patch }`. Change the verse list, the music bed (`music_library` refs or media files), the motion, music-only, or the captions. Free. |
| `ambient_render` | `{ id }`. Build the bed and render the video. Handle of kind `ambient`; an hour or more for long sessions, and a deploy stops it. One daily render and one plan `render` quota. Never posts. |
| `ambient_cancel` | `{ id }`. Stop the pictures or the render; also clears a session a restart left busy. Voicing cannot be stopped (`VOICING_CANNOT_CANCEL`: wait for it). `NOTHING_RUNNING` when nothing is running. Free. |
| `social_status` | Where you can publish: YouTube, playlists, auto-publish destinations, Buffer profiles, saved webhooks and schedules. No secrets. Free. |
| `publish_youtube` | `{ videoPath, title, ... }`. Upload to the connected channel. Handle of kind `publish`. Needs publish consent; one daily publish. |
| `publish_post` | `{ destination: "webhook" or "buffer", videoPath, caption, ... }`. Post to a saved webhook (and TikTok when connected) or Buffer. Needs publish consent; one daily publish. |
| `youtube_thumbnail` | `{ videoId, thumbnailPath }`. Replace a YouTube video's thumbnail. Needs publish consent; no daily publish. |
| `schedules` | `{ action: "list" or "create" or "remove", ... }`. Recurring posts, at most hourly. `create` and `remove` need publish consent; `create` is one daily publish (at most 5 agent-made schedules per account); `remove` only removes a schedule an agent created. |
| `autopublish_run` | One-click Auto-Publish: script, voice, render and post in one job (kind `job`). Needs publish consent; one daily render and one daily publish. |

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
- `kind` says which status route to read. The kinds are `job`, `captioned`, `story`, `ambient`, `timeline`, `instrumental` and `publish`. Every tool that starts work tells you the `kind` to use. For `story` and `ambient`, pass the project id as `id`. A story is `done` with `phase: "ready_to_render"` when its pictures are all made (no video yet; `output` is null), and `done` with `output` after `story_render`. While AI motion clips are being made it is `running` with `phase: "animating"`, and its handle carries `animation: { queued, generating, done, failed }`.
- An `ambient` session is `done` with `phase: "ready_to_render"` (or `"draft"`) when a voice or images step is over, `failed` when verses or pictures are still missing (the error says how many), and `done` with `output` after `ambient_render`. When a server restart stopped its work it is `failed` with an error that says so: call `ambient_cancel`, then run the step or `ambient_render` again.

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
4. `render_captioned` (the words from step 2 burned onto the video, or onto backgrounds under the audio), then `jobs_wait` with `kind: "captioned"`.

Stuck or finished jobs: `jobs_list`, `jobs_get`, `jobs_retry`, then `jobs_wait`.

### Short video from a Bible verse (available now)

1. `bible_lookup { mode: "verse", reference }` for the text, or `scripts_generate` for a whole script (hook, verse, reflection, call to action).
2. `voice_synthesize { text }` speaks it. Keep the returned `path`. One daily `tts` call.
3. `backgrounds_search { source, query }`, then `library_items { action: "download", source, sourceId }` for each clip you want. Keep each item's `id` (a library id). Or skip this and use `autoBackground: true` in the next step.
4. `render_short { lines, backgrounds: [library ids], audioPath }`. `lines` are the captions in order (1 to 12). Several backgrounds play one after another; pictures from your media folder work too. `musicPath` takes a `ref` from `music_library`. Returns `{ kind: "job", id, autoPublish }`. One daily render, plus four daily `images` with `autoBackground` (it may AI-generate pictures), and one unit of the plan's `render` quota (`QUOTA_EXCEEDED` before any cap is spent when it is used up). Videos are capped at the server's maximum length (30 seconds by default).
5. `jobs_wait { kind: "job", id }` until `status` is `done`. The handle's `output.path` is the finished video.
6. `publish_youtube { videoPath: output.path, title }` (needs publish consent), then `jobs_wait { kind: "publish", id }`.

If the user switched on auto-publish in Settings, a finished `render_short` is posted to their auto-publish platforms by itself. That happens only on a key that may publish, when auto-publish is on at the moment you start the render, and then the render also costs one daily publish (charged with the render, all or nothing). Every other render is queued with auto-publish off and never posts, even if auto-publish is switched on later. `autoPublish` in the result says `suppressed` (no consent), `off` or `on`. The same rule applies to `jobs_retry`. `render_captioned` never posts.

### Scripts and Bible (available now)

1. `bible_lookup` with `mode: "translations"` if you need a translation id, then `mode: "verse"` for the text of a reference, or `mode: "parse"` to check one.
2. `scripts_generate` for ready-made scripts. Leave out any field to get the default (10 scripts of about 20 seconds, theme `peace`). Each script has `hook`, `verse`, `reference`, `reflection`, `cta` and `hashtags`.

`scripts_generate` counts against the plan's daily `scripts` quota and has no agent cap. `bible_lookup` is free. Next, speak a script with `voice_synthesize`.

### Voice and audio (available now)

1. `voice_list` shows the voices of one provider (`edge`, free, by default; `elevenlabs` on premium plans), which providers are configured on this server, the voice profiles, and the voices you cloned.
2. `voice_synthesize { text, voiceId?, provider? }` speaks the text. `provider` is `auto` (default: ElevenLabs on premium, Edge-TTS otherwise, with fallback), `elevenlabs`, `edge`, `azure`, `chatterbox`, `fish` or `piper`. It returns `path` and `url`. Each call is one daily `tts` call and one unit of the plan's `tts` quota. ElevenLabs and Fish need a premium plan (`FEATURE_LOCKED` otherwise). Check `fallbackProvider` in the answer. `voiceId` is a voice name from `voice_list`, or a `cb:...` cloned voice with `provider: "chatterbox"` only; a file path is refused with `BAD_INPUT`.
3. `audio_process { inputPath, preset? }` cleans the file into a new mp3 (`preset` `clean_voice` by default; `podcast`, `warm` and `raw` too, and each step can be overridden). `audio_advanced` merges clips (`merge`), builds one file from trimmed clips (`timeline`), lays them over a video (`timeline_preview`) or reads a length (`info`). Clips may be music references (`library:...` or `mylib:...`) from `music_library`.
4. `transcribe` the result, then save the edited lines with `transcripts { action: "add", sourceFile, words, editedLines }`. `list` shows what you saved and `remove` deletes one.
5. `voice_clone { name, samplePaths, consent, provider? }` makes a custom voice from recordings in your media folder (premium plans; one daily `tts` call). Set the three `consent` flags to true only after the account owner has said they have the right to use that voice. With `provider: "chatterbox"` the answer is a `voiceId` like `cb:...` to use with `voice_synthesize` and `provider: "chatterbox"`.

These tools read and write files in your media folder only. `audio_process`, `audio_advanced` and `voice_clone` refuse a path outside it with `PATH_OUTSIDE_MEDIA` and do not accept URLs: bring a file in with `media_import_url` first. The only exception is a voice file another `voice_synthesize` call just wrote. `audio_advanced` cannot draw a waveform image.

### Backgrounds and images (available now)

1. `backgrounds_search { source, query, limit? }` looks for stock background **videos** on Pexels or Pixabay (there is no photo search). Each result has `id`, `previewUrl`, `image`, `durationSec`, `width`, `height` and `libraryId`. Searching is free and needs the provider key on the server. A search the Christian-library filter does not allow is refused.
2. Results are not in your library. `library_items { action: "download", source, sourceId, query? }` saves one onto the server (a few seconds; it counts against the daily `imports` cap, like `media_import_url`) and returns the item. Its `id` (for example `pexels_123`) is a **library id**, and the render tools accept a library id as a background.
3. `library_items` also does `list` (filter with `category`), `categories` (the tag names), `add { mediaPath, title?, categories? }` (a video from your media folder; URLs and paths outside it are refused with `PATH_OUTSIDE_MEDIA`) and `remove { id }`.
4. `images_generate { lines, aspect?, count? }` makes AI stills, one per line, up to four. Each image costs one daily `images` cap unit and one unit of the plan quota `imageGen`, and takes several seconds. Returns `images: [{ path, url }]`. `NOT_CONFIGURED` means this server has no image provider.
5. `visual_library` (super-admin keys only) lists (`list`), finds near-duplicate prompts (`similar`), tags and rates (`update`), deletes (`remove`, `force` if a video uses the clip) and `import`s a clip made elsewhere. Re-rolling a clip spends money and is not offered.

### Story video (available now)

Narration cut into scenes, one AI picture per scene, rendered with captions and a music bed. Two ways in:

- **From a recording:** `story_project { action: "create", title, style?, aspect?, cast? }`, then `story_process { id, mediaPath }` (an audio or video file in your media folder). It transcribes, segments and makes every picture in the background.
- **From a written script:** `voice_synthesize` the text, then `story_import_script { script, audioPath, durationMs, words?, autoStart: true }`. The script is used as written and nothing is transcribed. Without `autoStart`, call `story_step { step: "segment" }` (you can then edit prompts) and `story_step { step: "images" }` yourself.

Then:

1. `jobs_wait { kind: "story", id }` until `done` with `phase: "ready_to_render"`: every scene has a picture. `failed` says how many scenes have none (usually the daily image quota); `story_step { step: "images" }` makes only the missing ones.
2. Optional: `story_project { action: "get", id }` to look at the scenes, `story_scene_update { id, sceneId, prompt?, regenerate: true }` to replace one picture.
3. `story_settings { id, captions?, music?, cast? }`. `music.path` is a `ref` from `music_library` or a file in your media folder.
4. `story_render { id }`, then `jobs_wait { kind: "story", id }` until `done`. `output.path` is the video for `publish_youtube` or `publish_post`. A story render never posts by itself.

Costs. Each picture is one daily `images`. Picture-making tools charge up front: the scenes still without a picture, or for a new narration about one scene per 8 seconds, at most 60. That estimate is also the most scenes the narration is cut into, so you are never charged for fewer pictures than are made (reused library pictures are not given back). `story_render` is one daily render. Only work-starting calls count one unit of the plan's `render` quota: `story_process`, `story_step` `images` and `resegment`, `story_import_script` with `autoStart`, a `story_scene_update` regenerate, `story_animate` and `story_render`. Creating, importing without `autoStart`, segmenting, editing scenes, settings, deleting, reads and `story_cancel` are free. Tools that charge a daily cap check the plan quota first (`QUOTA_EXCEEDED`). `story_cancel` answers `NOTHING_RUNNING` when there is nothing to stop.

`story_step { step: "resegment" }` deletes every picture and makes new ones: it costs the images again. Use it only when the scenes themselves are wrong.

AI motion (super-admin keys only): `story_animate { id, estimateOnly: true }` prices it, then `story_animate { id }` charges the dollars to the daily `aiVideoUsd` cap and orders the clips. `jobs_wait { kind: "story" }` shows `phase: "animating"` and `animation` counts until they are in; then `story_render`. `story_cancel { what: "animate" }` stops further orders. A project set up in the app to animate itself refuses the picture tools with `AI_MOTION_PROJECT`.

### Ambient session (available now)

A long, music-first video (up to 10 hours): a music bed plays throughout, Bible verses are spoken over it at intervals, and each verse has its own picture (a movement).

1. `ambient_project { action: "create", title, theme, targetSec?, aspect?, translation? }`. Default two hours, landscape, `kjv`.
2. `ambient_plan { id, count? }` suggests verse references for the theme, by default one every fifteen minutes. It replaces the verse list. Change it with `ambient_update { section: "drops", patch: { drops: [...] } }` (always the whole list; each reference is one verse or up to 10 in one chapter, such as `Psalms 23:1-3`). Or set `ambient_update { section: "words", patch: { words: "none" } }` for music only.
3. `ambient_update { id, section: "bed", patch: { trackRefs: [...] } }` chooses the music: `ref`s from `music_library` (`library:...`, `mylib:...`) or audio files in your media folder; URLs and other paths are refused. The user's own tracks need a recorded licence (`UNCLEARED_TRACKS`). Only the user can record one, in the app's music library; agents cannot override it. A licence choice the user already made in the app is kept for changes that add no unlicensed track.
4. `ambient_step { id, step: "voice" }`, then `jobs_wait { kind: "ambient", id }`. Each verse is looked up word for word and spoken.
5. `ambient_step { id, step: "images" }`, then `jobs_wait { kind: "ambient", id }` until `done` with `phase: "ready_to_render"`. `failed` says how many pictures are missing; run the step again (it makes only those). `movementId` remakes one picture, `force: true` all of them.
6. Optional: `ambient_update` sections `motion` (`still` or `drift`) and `captions`.
7. `ambient_render { id }` (refused with `UNVOICED_VERSES` while verses are unvoiced, and `SESSION_BUSY` while a step runs), then `jobs_wait { kind: "ambient", id }`, again and again, until `done`. `output.path` is the video for `publish_youtube`; afterwards `ambient_project { action: "mark_published", id, videoId }` records the upload in the app. A render never posts by itself.

Costs. `ambient_step voice` is one daily `tts` per verse it speaks and `images` one daily `images` per picture it makes, both charged up front (a picture reused from your image library is not given back); each also counts one unit of the plan's `tts` or `imageGen` quota, checked first. `ambient_plan` is one unit of the plan's `scripts` quota. `ambient_render` is one daily render and one plan `render` quota. Everything else is free. A ten-hour session at the default cadence has about 40 verses, more than the default daily `tts` and `images` caps (30): ask `ambient_plan` for fewer verses, or make pictures over several days with `movementId`.

Time. Building the bed takes minutes and the render runs at about real time or slower, so a two-hour session can take an hour or more. A server deploy or restart stops whatever a session is doing; `jobs_wait` then reports `failed` and says so. Call `ambient_cancel`, then the step or `ambient_render` again (a bed already built is reused). Edits to the verses or the bed are refused while a step runs (`SESSION_BUSY`).

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

### Music (available now)

1. `music_library` lists the tracks. Note a track's `id` (for vocal removal) and its `ref` (to use as a bed or clip).
2. `music_remove_vocals { id }` starts vocal removal and returns `{ kind: "instrumental", id, status, where }`. It takes minutes, and `where` says whether this server or the operator's laptop does it. It is one daily render and one unit of the plan's `render` quota. If vocal removal is not set up you get a 409; `capabilities` shows `music.vocalRemoval`.
3. `jobs_wait { kind: "instrumental", id }`, repeated until `status` is `done`. The instrumental is saved to your music library as soon as it is finished.
4. `music_instrumental_decide { jobId, decision }`. `keep` returns the saved track; `discard` removes the track and its file (it also cancels a job that is still running).

### Branding (available now)

`branding { action: "get" }` shows whether the logo overlay is on, its corner, size and opacity, and whether a logo is uploaded. `branding { action: "set", enabled?, position?, size?, opacity? }` changes only the fields you pass. Turning it on fails until a logo exists; the logo image itself is uploaded in the app, not through MCP.

### Publishing (available now)

Publishing posts to the user's own accounts, as them, so it needs **consent**: the key owner switches on **This key may publish** for this key in **Settings, Connected agents**. Without it, `publish_youtube`, `publish_post`, `youtube_thumbnail`, `autopublish_run` and `schedules` `create`/`remove` fail with `PUBLISH_NOT_ALLOWED` and nothing is uploaded, posted or scheduled. `social_status` and `schedules` `list` work on any key. `whoami` shows the switch as `key.publishAllowed`.

1. `social_status` first: is YouTube connected (and its playlists), which auto-publish destinations exist, the Buffer profile ids, the saved webhooks (`id`, `name`, `enabled`) and the schedules. Tokens, secrets and webhook addresses are never returned. Accounts and webhooks are connected in the app's Settings; a key cannot change them.
2. A finished video from your media folder, usually `output.path` from `jobs_wait` after `render_short` or `render_captioned`. Every publish tool takes a `videoPath` in your media folder, never a URL.
3. Post it:
   - `publish_youtube { videoPath, title, description?, privacyStatus?, publishAt?, playlistId?, thumbnailPath? }` returns `{ kind: "publish", id }`; `jobs_wait { kind: "publish", id }` until it is `done`. Uploads are `private` unless you say otherwise. One daily publish.
   - `publish_post { destination: "webhook" or "buffer", videoPath, caption, webhookId? or profileIds? }` posts to a saved webhook (Make or Zapier; TikTok too when it is connected) or Buffer. It waits for the destination and returns `posted` with one result per destination. A `webhookId` must be one of the saved, enabled webhooks from `social_status` (`WEBHOOK_NOT_FOUND` otherwise; nothing is spent). One daily publish, spent only once the input is accepted.
   - `youtube_thumbnail { videoId, thumbnailPath }` changes the picture of a video already on the channel. Needs consent, but costs no daily publish.
4. `schedules { action: "create", cron, destination, type, ... }` posts by itself later: `replay` posts the same `videoPath` each time, `auto_generate` makes a fresh short each run. A schedule may run at most once an hour (`cron` has five fields and a single-number minute, for example `0 9 * * *`). Creating one costs one daily publish now. Its runs happen on the server later and are **not** charged to the key or its daily caps; each `auto_generate` run does spend one unit of the account's plan `render` quota, and a run with none left is skipped. Because the runs are not charged to the key, an agent may create at most **5** schedules per account (`SCHEDULE_LIMIT` after that). A schedule or `autopublish_run` with a `webhookId` posts to that webhook only: if the user later disables or removes it, the post fails and nothing is sent anywhere else. The account owner sees every schedule, and removes any of them, in the app's Settings. `list` shows them here; `remove { id }` removes only a schedule an agent created (any of the account's keys), and refuses one made in the app with `NOT_AGENT_SCHEDULE`.
5. `autopublish_run` does all of it in one job (the Home page's Auto-Publish): a new script, voice, backgrounds from your library, render and post. It needs at least one background in your library and costs one daily render, one daily publish and one unit of the plan's render quota (`QUOTA_EXCEEDED` before any cap is spent when the quota is used up). `jobs_wait { kind: "job", id }`.

The daily `publishes` cap is 3 per key by default.

## Quotas and daily caps

Two limits apply, and the lower one wins.

**Your plan quota.** The same daily quotas the app uses. A free account hits free limits. When you pass one, the call fails with `QUOTA_EXCEEDED` and a `hint`. `whoami` shows what is left in `quota` (buckets `scripts`, `tts`, `render` and `imageGen`; premium and admin accounts are unlimited).

**The daily agent caps.** Every key has its own counters, and they apply to every account, premium and admin included. Your account also has one shared counter per bucket that all your keys add to, and its limit is the server ceiling, so several keys together cannot pass it. They all reset at midnight UTC.

| Bucket | What counts | Default per key per day |
|---|---|---|
| `renders` | Tools that start a render | 10 |
| `aiVideoUsd` | AI video: the estimated cost in US dollars | 2 |
| `images` | Image generation | 30 |
| `tts` | Voice synthesis calls | 30 |
| `publishes` | Publishing calls, a schedule created, and a render that the user's auto-publish will post | 3 |
| `imports` | Files stored on the server from a URL: `media_import_url` and `library_items` `download` | 20 |

A call that would cross a cap is refused before anything runs, so nothing is spent. When the app itself refuses a call that was charged (an HTTP 4xx answer, such as `QUOTA_EXCEEDED`, a bad input or an account that is not connected), the caps it spent are given back on the key and the account, except `imports`: an import attempt always counts. A server error (5xx) or a dropped connection keeps the charge, because the work may have started. A cap refusal's error is `MCP_CAP_REACHED` with `bucket`, `scope`, `used`, `limit` and `resetsAt` (an ISO time, the next midnight UTC). `scope` is `key` when this key's own cap is reached, and `user` when your account's shared cap is reached across all your agents. Stop, tell the user, and retry after `resetsAt`.

`whoami` returns `caps` (this key) and `accountCaps` (all your keys together), each with `used`, `limit` and `remaining` for each bucket. Read it before starting a long plan. The server operator sets the ceilings with `MCP_DAILY_RENDERS`, `MCP_DAILY_AI_VIDEO_USD`, `MCP_DAILY_IMAGES`, `MCP_DAILY_TTS`, `MCP_DAILY_PUBLISHES` and `MCP_DAILY_IMPORTS`. The key owner can set lower numbers for one key under **Daily limits** on **Settings, Connected agents**.

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
| HTTP 401, `Missing Bearer token` | No `Authorization` header, or it is not `Bearer <key>`. | Send the header. Keys in the URL are ignored. |
| HTTP 401, `AGENT_KEY_REQUIRED` | The bearer is not an agent key, for example the app's own sign-in token (a JWT). `/api/mcp` takes agent keys only. | Create a key in **Settings**, **Connected agents** and send that. |
| Tool error `AGENT_FORBIDDEN` (`status` 403) | A key reached a route that keys may never use (account, billing, admin). | Do that in the app yourself. |
| Tool error with `status` 403 from the app | The user's plan or role does not allow it, for example a scene script on a non-admin account. | Use an account that has the right. The tool is normally not listed without it. |
| HTTP 403 on the connection itself, before any tool runs | The `Host` header is not on the allowed list. This is the usual symptom when you reach the server through a tunnel such as ngrok. | Add the tunnel host name to `MCP_ALLOWED_HOSTS` on the server (comma separated). |
| HTTP 405 | A `GET` or `DELETE` to `/api/mcp`. | Use `POST`. |
| HTTP 429, `RATE_LIMITED` | More than 120 requests a minute on one key. | Wait a minute. Use `jobs_wait` rather than polling in a loop. |
| `PUBLISH_NOT_ALLOWED` | The key's owner has not allowed publishing. | Ask them to switch on **This key may publish** in Settings, Connected agents. |
| `MCP_CAP_REACHED` | A daily cap is used up: this key's (`scope` `key`) or your account's across all agents (`scope` `user`). | Read `bucket`, `scope` and `resetsAt`. Wait for the reset, or ask the owner to raise the server ceiling. |
| `QUOTA_EXCEEDED` | The account's own plan quota is used up. | Wait for the daily reset or change plan in the app. |
| `BAD_KIND` | `jobs_wait` got a `kind` it does not know. | Use the `kind` the starting tool returned. |
| `PATH_OUTSIDE_MEDIA` | An audio or voice-clone tool was given a file that is not in your media folder, or a URL. | Use a path from `media_list` or `media_import_url`. |
| `FEATURE_LOCKED` (`status` 403) | The tool needs a premium plan, for example ElevenLabs or Fish voices, or `voice_clone`. | Use `provider: "edge"` or `auto`, or upgrade in the app. |
| `INVALID_URL`, `INVALID_KIND`, `INVALID_FILENAME`, `URL_PRIVATE`, `URL_SCHEME`, `URL_REDIRECTS`, `URL_TOO_LARGE`, `URL_TIMEOUT`, `DOWNLOAD_FAILED`, `IMPORT_FAILED` | `media_import_url` could not fetch the file. | See the table under Getting media in. |
| The tool call times out in the client | The client gave up before `jobs_wait` returned. | Lower `timeoutSec`, or raise the client timeout above 90 seconds (Hermes: `timeout: 120`). The job keeps running; call `jobs_wait` again. |
| A job is `running` for a long time | Renders are slow and queue behind other work. | Keep calling `jobs_wait`. If `status` becomes `failed`, read `error`, then try `jobs_retry`. |
| `INTERNAL` | The server hit an unexpected error. | Try once more, then tell the user. |
