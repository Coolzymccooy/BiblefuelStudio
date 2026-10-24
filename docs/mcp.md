# Connect an agent to BibleFuel

Give an AI agent a key, and it can drive BibleFuel Studio for you: find your media, transcribe it, make videos and wait for them to finish.

This guide has two parts. The first is for the agent, and is what it reads as the MCP resource `biblefuel://guide`. The second, from **Get a key** on, is for the person setting the agent up: the key, the client config and the full tool table. Agents can read it as `biblefuel://guide/setup`.

## First calls

- Call `whoami` first. It says who you act as, the plan, what is left of the plan `quota`, this key's daily `caps`, the account's `accountCaps` (all its keys together) and whether this key may publish (`key.publishAllowed`).
- `capabilities` describes the server (ffmpeg, configured providers, vocal removal, AI video), not this key: a free plan cannot use ElevenLabs even when `elevenlabs` is true. A tool missing from your `tools/list` is not for this key (some are for super-admin keys only), so do not call it.
- For Bible text use `bible_lookup`, not a web search. It is free and word for word.
- Tools take **server-side paths**, never URLs or files on your own machine. Reuse a file from `media_list`, bring one in with `media_import_url { url, kind? }`, or pass the `path` another tool returned. A file outside the user's media folder is refused with `PATH_OUTSIDE_MEDIA`.
- Anything slow returns a job handle at once. Wait for it with `jobs_wait` (see Waiting for jobs).
- You act as the user, with their plan, quotas and files and nothing more. A key may make 120 requests a minute (`RATE_LIMITED` past that).
- Ask the user for lyrics and for anything else only they know. Never invent them.
- Three prompts give a ready step list: `make_short_from_verse`, `make_ambient_session` and `make_lyric_video`. A client without prompts can follow the Pipelines below.

## How a call works

Every tool takes a JSON object and returns the result twice: `structuredContent` (an object) and a text block holding it as JSON. A failure has `isError: true`; its text reads `CODE: message` and `structuredContent` holds the same as an object:

```json
{ "error": "MCP_CAP_REACHED", "message": "Daily renders cap reached for this agent (10 of 10).", "bucket": "renders", "scope": "key", "used": 10, "limit": 10, "needed": 1, "resetsAt": "2026-10-24T00:00:00.000Z" }
```

Branch on the code, not the message. Errors from the app's routes also carry `hint` (what to do) and `status` (the HTTP status). Every call passes, in order: publish consent (publishing tools only), the daily caps, the tool itself (it calls the app as the user, so plan quotas apply), and the activity log.

## Waiting for jobs

Anything slow returns a **job handle** immediately and keeps working in the background:

```json
{ "kind": "job", "id": "job_ab12cd", "status": "running", "percent": 42, "phase": null, "output": null, "error": null }
```

- `status` is `queued`, `running`, `done`, `failed` or `cancelled`. Stop at `done`, `failed` or `cancelled`.
- `percent` is 0 to 100, or `null` when the job does not report progress.
- `output` is `{ url, path }` once there is a file: `url` is public and playable, `path` is the real file on the server, which other tools take.
- `error` is a short message when `status` is `failed`. After a server restart it says what to call.
- A finished `render_short` handle (kind `job`) has `durationSec`, the video's real length. Report that, not the length you asked for: with a voice track the video is as long as the voice.
- `kind` says which status route to read: `job`, `captioned`, `story`, `ambient`, `lyric_align`, `lyric_render`, `moments`, `scene`, `longform`, `timeline`, `instrumental` or `publish`. The tool that started the work names it. For `story`, `ambient`, `lyric_align`, `moments`, `scene` and `longform` the id is the project id. For `lyric_render` pass the render's job id as `id` and the song's id as `projectId` (both are on its handle); without `projectId` the wait is refused with `BAD_INPUT`.

`jobs_wait { kind, id, projectId?, timeoutSec? }` checks every 3 seconds and returns when the job ends or `timeoutSec` passes (1 to 90, default 60; many agents give up on a call after 120 seconds). If the handle still says `queued` or `running`, call it again with the same arguments: a render can need many calls. An unknown `kind` is `BAD_KIND`.

`jobs_cancel { kind, id, projectId? }` stops a queued or running job of kind `job`, `captioned`, `story`, `longform`, `ambient`, `moments`, `scene` or `lyric_render`. It answers `NOTHING_RUNNING` when the job is not running, and `VOICING_CANNOT_CANCEL` while verses or lines are being voiced (that finishes by itself). Free.

`jobs_list` lists the queued render jobs only (kind `job`: `render_short`, `autopublish_run`, `series_generate` parts and retries). Other jobs are on their feature's project tool (`story_project`, `lyric_project`, `ambient_project` and so on).

What some kinds mean:

- `story`: `done` with `phase: "ready_to_render"` when every scene has a picture (no video yet), `done` with `output` after `story_render`, `running` with `phase: "animating"` and `animation` counts while AI motion clips are made.
- `lyric_align`: `done` with `lines: { total, timed, flagged }` (flagged lines could not be heard and were squeezed in); `failed` when timing has not run on the current lyrics.
- `ambient`: `done` with `phase: "ready_to_render"` (or `"draft"`) when a voice or images step is over, `failed` when verses or pictures are missing (the error says how many), `done` with `output` after `ambient_render`.
- `scene`: `running` with `phase` `voicing`, `making_shots` or `rendering`; once idle, `done` with `phase` `"rendered"`, `"ready_to_render"` or `"not_ready"` plus `blockers`, or `failed` naming the stage (`Voicing:`, `Shots:`, `Render:`).
- `longform`: `running` with `phase: "narrating"` while the outline is voiced, then like a story. A draft never narrated is `done` with `phase: "draft_script"`.
- `moments`: `failed` when no render was started.

## Pipelines

Each pipeline is an ordered list of tools. Costs are in daily agent caps (`renders`, `tts`, `images`, `publishes`, `imports`, `aiVideoUsd`) and in the plan quota (`render`, `tts`, `imageGen`, `scripts`); see Quotas and daily caps. A tool that charges a cap checks the plan quota first (`QUOTA_EXCEEDED`, nothing spent). Renders never post by themselves unless this says so.

### Media: import, transcribe, trim

1. `media_import_url` (or `media_list` to reuse a file). One daily `imports`, spent even when the download fails.
2. `transcribe { mediaPath }`: words with `startMs` and `endMs`. One plan `render` quota.
3. `media_trim` (optional): cut a new file by seconds.
4. `render_captioned`: the words burned onto a video (`videoPath`), or onto backgrounds under an audio file (`audioPath`, `backgrounds`). Then `jobs_wait` with kind `captioned`. One daily render and one plan `render` quota.

### Short video from a Bible verse

1. `bible_lookup { mode: "verse", reference }` for the text (or `scripts_generate` for a whole script; one plan `scripts` quota).
2. `voice_synthesize { text, provider? }` speaks it; keep the returned `path`. One daily `tts` and one plan `tts` quota; a failed call gives both back. On a free plan `provider` `auto` is Edge-TTS, falling back to Azure when Azure is configured: when that fails too, force a provider `voice_list` shows as available. `voice_list { locale: "en" }` keeps the voice list short.
3. `backgrounds_search { source, query }`, then `library_items { action: "download", source, sourceId }` for each clip (one daily `imports` each); keep each item's `id`, a library id. Or skip this and pass `autoBackground: true` next (four daily `images`, for pictures it may generate).
4. `render_short { lines, backgrounds, audioPath }`: the captions in order (1 to 12) over the backgrounds, one after another. `musicPath` takes a `ref` from `music_library`. One daily render and one plan `render` quota. With a voice the video is as long as the voice (one verse is about 6 seconds), and `durationSec` only sets the length of a video without one; for a longer short, speak more lines. Videos are capped at 30 seconds by default.
5. `jobs_wait { kind: "job", id }` until `done`. `output.path` is the video and `durationSec` its real length.
6. `publish_youtube { videoPath: output.path, title }` (publish consent), then `jobs_wait` with kind `publish`.

If the user switched on auto-publish in Settings, a finished `render_short` posts itself, but only on a key that may publish and with auto-publish on when the render starts; it then also costs one daily publish. Otherwise it is queued with auto-publish off. `autoPublish` in the result says `suppressed`, `off` or `on`. `jobs_retry` follows the same rule.

### Voice and audio

1. `voice_list { locale? }`: voices of one provider (`edge` by default), every provider's status, voice profiles and cloned voices. The whole edge list is over 300 voices, so pass `locale`.
2. `voice_synthesize { text, voiceId?, provider? }`: `provider` is `auto`, `elevenlabs`, `edge`, `azure`, `chatterbox`, `fish` or `piper`. ElevenLabs and Fish need a premium plan (`FEATURE_LOCKED`). Options such as rate are ignored with `auto`. `voiceId` is a voice name from `voice_list`, or a `cb:...` cloned voice with `provider: "chatterbox"`.
3. `audio_process { inputPath, preset? }` cleans a file into a new mp3; `audio_advanced` merges clips, builds one file from trimmed clips, lays them over a video (`timeline_preview`) or reads a length.
4. `transcripts { action: "add", sourceFile, words, editedLines }` saves an edited transcript.
5. `voice_clone { name, samplePaths, consent }` (premium; one daily `tts`). Set the `consent` flags only after the owner says they have the right to that voice.

### Backgrounds and images

1. `backgrounds_search { source: "pexels" or "pixabay", query }`: stock background videos (no photos). Free.
2. `library_items { action: "download", source, sourceId }` saves one (one daily `imports`). Its `id` is a library id that the render tools take as a background. `library_items` also lists, adds a video from the media folder and removes.
3. `images_generate { lines, aspect?, count? }`: AI stills, one per line, up to four. One daily `images` and one plan `imageGen` quota per image.

### Story video

Narration cut into scenes, one AI picture per scene, rendered with captions and a music bed.

1. Either `story_project { action: "create", title }` and `story_process { id, mediaPath }` (a recording: it transcribes, cuts scenes and makes pictures), or `voice_synthesize` a script and `story_import_script { script, audioPath, durationMs, autoStart: true }`.
2. `jobs_wait { kind: "story", id }` until `done` with `phase: "ready_to_render"`. `failed` says how many scenes have no picture (usually the daily images); `story_step { step: "images" }` makes only the missing ones.
3. Optional: `story_scene_update { id, sceneId, prompt?, regenerate: true }` replaces one picture; `story_settings { id, captions?, music? }` sets the captions and the bed.
4. `story_render { id }`, then `jobs_wait { kind: "story", id }` until `done` with `output`.

Costs. Each picture is one daily `images`, charged up front (about one scene per 8 seconds of narration, at most 60). `story_render` is one daily render. The work-starting calls (`story_process`, `story_step` images and resegment, `story_import_script` with `autoStart`, a regenerate, `story_animate`, `story_render`) each count one plan `render` quota; the rest is free. `story_step { step: "resegment" }` deletes every picture and pays for them again. AI motion clips (`story_animate`, super-admin keys only) are priced with `estimateOnly: true` and charged to `aiVideoUsd`. A second `story_render` while one runs is `SESSION_BUSY` (free). After a deploy, `jobs_wait` reads `failed` with "This stopped when the server restarted": call `story_cancel`, then `story_process` or `story_render` again.

### Ambient session

A long, music-first video (up to 10 hours): a bed plays throughout, verses are spoken over it, each with its own picture.

1. `ambient_project { action: "create", title, theme, targetSec? }` (default two hours).
2. `ambient_plan { id }` suggests verses (one plan `scripts` quota). Change them with `ambient_update { section: "drops" }` (always the whole list), or `ambient_update { section: "words", patch: { words: "none" } }` for music only.
3. `ambient_update { id, section: "bed", patch: { trackRefs } }`: refs from `music_library` or audio files in the media folder. The user's own tracks need a licence recorded in the app (`UNCLEARED_TRACKS`).
4. `ambient_step { id, step: "voice" }`, then `jobs_wait { kind: "ambient", id }`. One daily `tts` per verse.
5. `ambient_step { id, step: "images" }`, then `jobs_wait` until `ready_to_render`. One daily `images` per picture; a rerun makes only the missing ones, `movementId` one picture.
6. `ambient_render { id }`, then `jobs_wait { kind: "ambient", id }` again and again: an hour or more for a long session. One daily render and one plan `render` quota. Then `ambient_project { action: "mark_published", id, videoId }` after an upload.

A ten-hour session has about 40 verses, more than the daily `tts` and `images` caps (30): plan fewer verses and add the rest over several days. Edits are refused while a step runs (`SESSION_BUSY`), and `ambient_render` while verses are unvoiced (`UNVOICED_VERSES`). After a restart: `ambient_cancel`, then the step or `ambient_render` again (a bed already built is reused).

### Lyric video

A song with its lyrics timed to the singing, drawn as moving captions.

1. `lyric_project { action: "create", title }`.
2. `lyric_set_song { id, path }`: an audio or video file in the user's own media folder, at most 15 minutes.
3. `lyric_set_lyrics { id, sheet }`: one sung line per line, headings such as `[CHORUS]` on their own lines. Ask the user for the lyrics: `transcribe` rarely recovers sung words over music, and it spends a plan `render` quota.
4. `lyric_align { id }`, then `jobs_wait { kind: "lyric_align", id }`. One daily render and one plan `render` quota.
5. Optional: `lyric_line_update` moves one line; `lyric_background` sets the picture or video, the look and the logo switches.
6. `lyric_render { id, aspect? }`, then `jobs_wait { kind: "lyric_render", id: <job id>, projectId: <song id> }`. One daily render and one plan `render` quota. `lyric_project { action: "publish_draft", id }` gives a title and description.

The paid steps are refused at no cost without a song (`NO_SONG`), lyrics (`NO_LYRICS`) or timing (`NOT_TIMED`), or while one runs (`ALREADY_RUNNING`, `SONG_BUSY`). One render per account at a time.

### Moments

A 15, 30 or 60 second photo video for an occasion, cut to a song.

1. `moments_project { action: "meta" }` (occasions, styles, the image library), then `{ action: "create", occasion }`.
2. `moments_project { action: "update", id, photos, song? }`: 3 to 20 photos, each `{ path }` of an image imported with `media_import_url` (kind `image`) or `{ libraryId }`.
3. Optional: `moments_step { step: "statements" }` suggests lines (one plan `scripts` quota); `moments_step { step: "voiceover" }` speaks one (one daily `tts`).
4. `moments_render { id }`, then `jobs_wait { kind: "moments", id }`. One daily render and one plan `render` quota; refused at no cost with fewer than 3 photos (`NEEDS_PHOTOS`) or while one renders (`MOMENT_BUSY`).

### Timeline

1. `timeline_project { action: "get", id }` or build a project (assets and lanes of clips), then `timeline_project { action: "save", project }`. Asset paths must be media files, library ids or music refs.
2. `timeline_render { projectId }`, then `jobs_wait { kind: "timeline", id }`. One daily render and one plan `render` quota, plus one daily `tts` per voiceover clip it speaks.

### Scene script (super-admin keys only)

1. `scene_script_project { action: "parse", markdown }` previews a script and prices its clips; then `{ action: "create", markdown }`.
2. `scene_script_step { id, step: "voice" }`, then `jobs_wait { kind: "scene", id }`. One daily `tts`.
3. `scene_script_shots { id, estimateOnly: true }`, then `scene_script_shots { id }` orders the clips (charged to `aiVideoUsd`; over the benchmark only with `confirmOverBenchmark: true` after the user agrees).
4. `scene_script_render { id }` once every line is voiced and every shot has a clip (`NOT_READY` with `blockers` otherwise, nothing spent), then `jobs_wait`. One daily render. Over the benchmark, step 3 is `OVER_BENCHMARK`.

### Series

1. `series_project { action: "preview", reference }` shows the parts. Free.
2. `series_generate { reference, destination? }` (publish consent) queues and posts one short per part, each a job of kind `job`. Per part: one daily render, one daily publish and one plan `render` quota, charged together first (`QUOTA_EXCEEDED`, nothing spent, when fewer renders are left than parts). A webhook is chosen by its saved id from `social_status`, never a URL. The default daily `publishes` cap is 3.

### Long-form

30 and 60 minute sleep sessions: a story project with an outline and a narration stage first.

1. `longform_project { action: "templates" }`, then `{ action: "draft", script or idea or audioPath }` (one daily render and one plan `render` quota; waits a minute or two).
2. `longform_narrate { id, voiceId? }`, then `jobs_wait { kind: "longform", id }` until `ready_to_render`. One daily `tts` per section and daily `images` for the pictures, charged up front, and one plan `render` quota.
3. `story_settings { id, music? }`, then `story_render { id }` and `jobs_wait { kind: "story", id }`.

A narration a restart stopped reads `failed`: call `longform_narrate` again (voiced chunks are reused). After a failed narration, `longform_project { action: "reopen", id }` makes it a draft again.

### Music, queue, branding, Gumroad

- `music_library` lists tracks (`id` for vocal removal, `ref` as a bed). `music_remove_vocals { id }` (one daily render and one plan `render` quota), `jobs_wait` with kind `instrumental`, then `music_instrumental_decide { jobId, decision }`.
- `queue_items` keeps post ideas (`clear` deletes every one; only when asked). `branding { action: "get" or "set" }` reads or sets the logo overlay (the logo itself is uploaded in the app). `gumroad` writes a free ebook and a paid devotional (only on plans with the Gumroad feature). All free.

### Publishing

Publishing posts to the user's own accounts as them, so it needs the key owner's consent (**This key may publish**). Without it, `publish_youtube`, `publish_post`, `youtube_thumbnail`, `autopublish_run`, `series_generate` and `schedules` create and remove fail with `PUBLISH_NOT_ALLOWED` and nothing is posted.

1. `social_status`: what is connected (YouTube and playlists, auto-publish destinations, Buffer profiles, saved webhooks, schedules). No secrets.
2. A finished video in the media folder, usually a handle's `output.path`. Never a URL.
3. `publish_youtube { videoPath, title }` (private unless you say otherwise), then `jobs_wait { kind: "publish", id }`; or `publish_post { destination: "webhook" or "buffer", videoPath, caption }`, where a `webhookId` must be a saved, enabled webhook from `social_status` (`WEBHOOK_NOT_FOUND`, nothing spent). One daily publish each. `youtube_thumbnail` needs consent but no daily publish.
4. `schedules { action: "create", cron, destination, type }` posts later, at most hourly (`cron` has five fields, for example `0 9 * * *`): `replay` posts the same `videoPath`, `auto_generate` makes a fresh short each run (one plan `render` quota per run). One daily publish now; its runs are not charged to the key, so an agent may create at most 5 per account (`SCHEDULE_LIMIT`). `remove` removes only a schedule an agent made (`NOT_AGENT_SCHEDULE`).
5. `autopublish_run` does script, voice, render and post in one job of kind `job`: one daily render, one daily publish and one plan `render` quota.

## Quotas and daily caps

Two limits apply, and the lower one wins.

**The plan quota.** The same daily quotas the app uses: buckets `scripts`, `tts`, `render` and `imageGen` (premium and admin accounts are unlimited). Past one, the call fails with `QUOTA_EXCEEDED` and a `hint`.

**The daily agent caps.** Every key has its own counters, and every account one shared counter per bucket that all its keys add to. They apply to every plan and reset at midnight UTC.

| Bucket | What counts | Default per key per day |
|---|---|---|
| `renders` | Tools that start a render, and `lyric_align` timing runs | 10 |
| `aiVideoUsd` | AI video: the estimated cost in US dollars | 2 |
| `images` | Image generation | 30 |
| `tts` | Voice synthesis calls | 30 |
| `publishes` | Publishing calls, a schedule created, and a render the user's auto-publish will post | 3 |
| `imports` | Files stored on the server from a URL: `media_import_url` and `library_items` `download` | 20 |

A call that would cross a cap is refused before anything runs, with `MCP_CAP_REACHED` and `bucket`, `scope` (`key`: this key's cap; `user`: the account's, across all its agents), `used`, `limit`, `needed` and `resetsAt`. A call can be refused with some of the cap left when it needs more than that (`autoBackground` needs four `images`). When the app itself refuses a charged call (an HTTP 4xx), its caps are given back, except `imports`; a 5xx or a dropped connection keeps the charge (except `voice_synthesize`, which gives its `tts` back on a 5xx). Read `whoami` before a long plan; on a cap, stop, tell the user and retry after `resetsAt`.

## What a key can never do

- Go past its user: it has exactly the plan, role and files of the person who made it.
- Publish without consent (`PUBLISH_NOT_ALLOWED`).
- Manage the account: delete it, manage keys, change the plan or billing, use admin routes (`AGENT_FORBIDDEN`).
- Reach private networks: `media_import_url` refuses private, local and non-http addresses.
- Skip the caps, or hide: every call is written to an activity log the owner can read.

## Troubleshooting

| You see | Cause | Fix |
|---|---|---|
| HTTP 401, `AGENT_KEY_INVALID`, `Missing Bearer token` or `AGENT_KEY_REQUIRED` | The key is wrong, revoked or missing, or the bearer is not an agent key (an app sign-in token). | The owner checks the key, or creates one in **Settings**, **Connected agents**. |
| Tool error `AGENT_FORBIDDEN` (`status` 403) | A route keys may never use (account, billing, admin). | The user does it in the app. |
| Tool error with `status` 403 from the app | The plan or role does not allow it. | Use an account that has the right. |
| The scene script tools, `story_animate` or `visual_library` are missing, or answer `FORBIDDEN` (403) | They are for super-admin keys only. | Use the other pipelines. |
| HTTP 403 on the connection itself | The `Host` header is not allowed, usually a tunnel such as ngrok. | Add the host to `MCP_ALLOWED_HOSTS` on the server. |
| HTTP 429, `RATE_LIMITED` | More than 120 requests a minute on one key. | Wait a minute; use `jobs_wait` rather than polling. |
| `PUBLISH_NOT_ALLOWED` | The owner has not allowed publishing. | Ask them to switch on **This key may publish**. |
| `MCP_CAP_REACHED` | A daily cap is used up, this key's (`scope` `key`) or the account's (`scope` `user`). | Wait for `resetsAt`, or ask the owner to raise the ceiling. |
| `QUOTA_EXCEEDED` | The plan quota is used up. | Wait for the daily reset, or change plan in the app. |
| `BAD_KIND` | `jobs_wait` or `jobs_cancel` got a `kind` it does not take. | Use the `kind` the starting tool returned. |
| `NOTHING_RUNNING` | A cancel found nothing queued or running. | Nothing to stop: read the handle. |
| `PATH_OUTSIDE_MEDIA` | A file not in the media folder, or a URL. | Use a path from `media_list`, `media_import_url` or a tool's output. |
| `FEATURE_LOCKED` (`status` 403) | It needs a premium plan (ElevenLabs or Fish voices, `voice_clone`). | Use `provider: "edge"` or `"azure"`, or upgrade in the app. |
| `INVALID_URL`, `URL_PRIVATE`, `URL_TOO_LARGE`, `DOWNLOAD_FAILED` and the other import codes | `media_import_url` could not fetch the file. | See Getting media in, in the setup part. |
| The tool call times out in the client | The client gave up before `jobs_wait` returned. | Lower `timeoutSec`, or raise the client timeout above 90 seconds. The job keeps running. |
| A job is `running` for a long time | Renders are slow and queue behind other work. | Keep calling `jobs_wait`. If it becomes `failed`, read `error`, then `jobs_retry`. |
| A job reads `failed` after a server deploy or restart | A deploy stops the work in progress; the handle's error says the server restarted or the render was interrupted. | Do what the error says: usually the feature's cancel tool, then the step or render again. Starting again costs again. |
| A `job` handle reads `failed` with "Interrupted by a server restart. Retry it." | A deploy or restart stopped the render. When the server starts it marks every queue job that was running as `failed` (with `interrupted: true` on the job), whatever its age (issue #118). | Call `jobs_retry` with the job id: it queues a new job with the same settings and spends a render, as a new render would. The user can also press Retry on the Jobs page. |
| Reading `biblefuel://jobs/...` fails with `BAD_KIND`, `BAD_INPUT`, `HTTP_404` or `HTTP_403` | An unknown kind, a `lyric_render` without `?projectId=`, or a job that is not yours (a `captioned` job of another user answers `HTTP_403`). | Use the `kind`, `id` and `projectId` from the handle. |
| `INTERNAL` | The server hit an unexpected error. | Try once more, then tell the user. |

<!-- biblefuel://guide ends here. Everything below is biblefuel://guide/setup. -->

## Get a key

BibleFuel runs a Model Context Protocol (MCP) server. An agent connects to one URL and gets a list of tools. Each tool does one thing you can already do in the app.

- Endpoint: `https://biblefuel.tiwaton.co.uk/api/mcp`
- Transport: Streamable HTTP. Send `POST` requests only. `GET` and `DELETE` answer 405.
- Authentication: `Authorization: Bearer bfk_...` header, with an agent key only. Keys in a query string are never accepted, and an app sign-in token (a JWT) is refused with `AGENT_KEY_REQUIRED`.
- Identity: the agent acts as you. It gets your plan, your quotas and your files, and nothing more.
- Instructions: when an agent connects, the server sends a short paragraph of instructions (call `whoami` first, use `bible_lookup` for verse text, wait for jobs with `jobs_wait`, read this guide for the pipelines). Most clients hand it to the model before its first call.

To make a key:

1. Sign in to BibleFuel and open **Settings**, then **Connected agents**.
2. Choose **Create key** and give it a name, for example `hermes laptop`.
3. Copy the key now. It starts with `bfk_` and is shown once. BibleFuel stores only a hash, so a lost key cannot be recovered. Revoke it and create another.

Good to know:

- You can hold 10 live keys. Revoke a key on the same card; it stops working at once.
- **This key may publish** is off for a new key. Turn it on only for an agent you trust to post to your connected accounts as you.
- Each key can have lower daily caps than the server default. Open **Daily limits** under the key, change a number and choose **Save limits**. Each number can go from 0 up to the server's ceiling, shown under it; a higher number is saved as the ceiling. You cannot raise a key above it. The server operator sets the ceilings with `MCP_DAILY_RENDERS`, `MCP_DAILY_AI_VIDEO_USD`, `MCP_DAILY_IMAGES`, `MCP_DAILY_TTS`, `MCP_DAILY_PUBLISHES` and `MCP_DAILY_IMPORTS`.
- Every tool call is written to an activity log: time, key, tool, a trimmed copy of the input (text is cut to 200 characters, secret fields are dropped, file bytes are never kept), whether it worked, how long it took, the job it started and the caps it used. Key creation, revocation and consent changes are logged too. Entries are kept 90 days. You see your own keys' recent calls on **Settings, Connected agents**, and can export them as CSV.
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

## Tool reference

### Tools available today

| Tool | What it does |
|---|---|
| `whoami` | Who you act as, your plan, remaining plan `quota`, this key's daily `caps`, your account's `accountCaps` (all your keys together) and the publish permission. Call it first. |
| `capabilities` | What this server can do right now: ffmpeg, which providers are configured, vocal removal, AI video. It describes the server, not this key: a free plan cannot use ElevenLabs even when it is configured. |
| `media_list` | `{ kind: "audio" or "video" }`. Your files, newest first, each with `name`, `path`, `size`, `mtime`. |
| `media_import_url` | `{ url, kind?, filename? }`. Download a public file into your media. `kind` is `audio` (default), `video` or `image`. One daily `imports`, spent even when the download fails. |
| `media_trim` | `{ inputPath, startSec, endSec }`. Cut a file into a new file. The original stays. |
| `transcribe` | `{ mediaPath }`. Words with `startMs` and `endMs`, plus `durationMs`. Counts against your daily render quota. |
| `jobs_list` | `{ limit? }`. Your recent queued render jobs only (kind `job`: `render_short`, `autopublish_run`, `series_generate` parts), newest first. Other features' jobs are on their own project tools. |
| `jobs_get` | `{ id }`. One queued job as a job handle. |
| `jobs_retry` | `{ id }`. Re-queue a finished or failed job. Returns a new job. One daily render. A render (`render_video`, `render_waveform`) or posting job (`campaign_auto_post`) also spends one plan `render` quota (`QUOTA_EXCEEDED` before any cap is spent). A posting job needs publish consent and also costs one daily publish; a render that the user's auto-publish would post costs one daily publish with consent, and without consent is queued so it never posts. |
| `jobs_wait` | `{ kind, id, projectId?, timeoutSec? }`. Wait for any background job. See Waiting for jobs. |
| `jobs_cancel` | `{ kind, id, projectId? }`. Stop a queued or running job of kind `job`, `captioned`, `story`, `longform`, `ambient`, `moments`, `scene` or `lyric_render`. `NOTHING_RUNNING` when it is not running. Free. |
| `scripts_generate` | Short Bible video scripts (hook, verse, reflection, call to action, hashtags). Every field optional. Counts against the plan's `scripts` quota. |
| `bible_lookup` | `{ mode: "verse" or "parse" or "translations", reference?, translation? }`. Verse text, reference parsing, or the translation list. Free. |
| `voice_list` | `{ provider?, locale? }`. Voices of one provider (`edge` by default, or `elevenlabs`), every provider's status, the voice profiles and your cloned voices. Pass `locale` (`en`, `en-GB`): the whole edge list is over 300 voices. |
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
| `render_short` | `{ lines, backgrounds? or autoBackground?, audioPath?, musicPath?, ... }`. A short captioned video. Job handle of kind `job`; the finished handle's `durationSec` is the real length. One daily render (plus four `images` with `autoBackground`). |
| `render_captioned` | `{ videoPath }` or `{ audioPath, backgrounds }`, plus `words` from `transcribe`. Word-by-word captions. Handle of kind `captioned`. One daily render and one plan `render` quota. |
| `story_project` | `{ action: "list" or "get" or "create" or "delete" or "characters", ... }`. Story video projects; `get` shows the scenes with their pictures and a story job handle; `characters` lists the cast keys. |
| `story_import_script` | `{ script, audioPath, durationMs, words?, autoStart?, ... }`. A story from a written script and its narration. With `autoStart` the pictures are made at once (daily `images`, estimated up front); handle of kind `story`. |
| `story_process` | `{ id, mediaPath }`. Transcribe a recording, cut it into scenes and make the pictures, in the background. Handle of kind `story`. Daily `images` for the pictures, estimated up front. |
| `story_step` | `{ id, step: "segment" or "resegment" or "images", force? }`. One step. `images` costs one daily `images` per picture made; `resegment` deletes every picture and makes new ones. |
| `story_scene_update` | `{ id, sceneId, prompt?, text?, regenerate? }`. Edit a scene; `regenerate` makes a new picture now (one daily `images`, given back if none is made). |
| `story_settings` | `{ id, captions?, music?, cast? }`. Caption mode and look, the music bed (a `music_library` ref or a media file), the cast. |
| `story_render` | `{ id }`. Render the video once every scene has a picture. Handle of kind `story`. One daily render and one plan `render` quota. Never posts. |
| `story_animate` | `{ id, sceneIds?, quality?, estimateOnly? }`. Paid AI motion clips for scenes. Super-admin keys only; the estimate's dollars are charged to the daily `aiVideoUsd` cap first. |
| `story_cancel` | `{ id, what?: "render" or "animate" }`. Stop the pictures or render, or stop ordering AI clips; also clears a project a restart left marked busy. Free. |
| `ambient_project` | `{ action: "list" or "get" or "create" or "delete" or "mark_published", ... }`. Ambient sessions (long music-first scripture videos); `get` shows the verses, pictures, bed and an ambient job handle; `mark_published` records a YouTube upload (posts nothing). Free. |
| `ambient_plan` | `{ id, count? }`. Suggest verse references for the theme, spaced across the length. Replaces every verse. One plan `scripts` quota. |
| `ambient_step` | `{ id, step: "voice" or "images", force?, movementId? }`. Speak the verses (one daily `tts` per verse) or make the pictures (one daily `images` per picture), charged up front, in the background. Handle of kind `ambient`. |
| `ambient_update` | `{ id, section: "drops" or "bed" or "motion" or "words" or "captions", patch }`. Change the verse list, the music bed (`music_library` refs or media files), the motion, music-only, or the captions. Free. |
| `ambient_render` | `{ id }`. Build the bed and render the video. Handle of kind `ambient`; an hour or more for long sessions, and a deploy stops it. One daily render and one plan `render` quota. Never posts. |
| `ambient_cancel` | `{ id }`. Stop the pictures or the render; also clears a session a restart left busy. Voicing cannot be stopped (`VOICING_CANNOT_CANCEL`: wait for it). `NOTHING_RUNNING` when nothing is running. Free. |
| `lyric_project` | `{ action: "list" or "get" or "create" or "delete" or "renders" or "publish_draft" or "cancel_render", ... }`. Lyric videos (song mode); `get` shows the song, lines with their times, the timing state and a `lyric_align` handle; `renders` lists every video made; `publish_draft` gives a YouTube title and description. Free. |
| `lyric_set_song` | `{ id, path }`. The song: an audio file, or a video whose sound is taken out, in your media folder. Clears the old timing. Free. |
| `lyric_set_lyrics` | `{ id, sheet }`. The lyrics as one sheet, section headings on their own lines. Free. |
| `lyric_align` | `{ id }`. Time the lyrics to the singing, in the background. Handle of kind `lyric_align`. One daily render and one plan `render` quota; refused at no cost without a song or lyrics or while timing runs. |
| `lyric_line_update` | `{ id, lineId, start?, effect? }`. Move one timed line (it is then kept by later timing runs) or change how it is drawn. Free. |
| `lyric_background` | `{ id, path?, fit?, look?, branding? }`. The background picture or video, the caption look and the logo, intro and end card switches. Free. |
| `lyric_render` | `{ id, aspect?, quality?, shortsTrim? }`. Render the video. Handle of kind `lyric_render` with the job id as `id` and the song as `projectId`. One daily render and one plan `render` quota. Never posts. |
| `moments_project` | `{ action: "list" or "get" or "create" or "update" or "delete" or "meta", ... }`. Short photo videos for occasions; `update` sets the words, photos (imported images or image library ids), song and length; `meta` lists the choices and your image library. Free. |
| `moments_step` | `{ id, step: "statements" or "voiceover", script?, idea?, voiceId? }`. Suggest the title and lines (one plan `scripts` quota), or speak a voiceover (one daily `tts`). |
| `moments_render` | `{ id, seed? }`. Render the Moment (at least 3 photos). Handle of kind `moments`. One daily render and one plan `render` quota. Never posts. |
| `moments_cancel` | `{ id }`. Stop a running Moment render. `NOTHING_RUNNING` when none runs. Free. |
| `timeline_project` | `{ action: "list" or "get" or "save", id?, project? }`. Multi-lane Timeline projects; `save` stores a whole project. Asset paths must be your media files or music refs. Free. |
| `timeline_render` | `{ projectId or project, quality?, caption options... }`. Render a timeline. Handle of kind `timeline`. One daily render and one plan `render` quota, plus one daily `tts` per voiceover clip it speaks. Never posts. |
| `scene_script_project` | `{ action: "list" or "get" or "create" or "update" or "delete" or "parse" or "voices", ... }`. Scene scripts written in markdown; `parse` previews one and prices its clips without saving; `get` shows lines, shots, music cues, blockers and a scene job handle. Super-admin keys only. Free. |
| `scene_script_step` | `{ id, step: "voice" or "suggest_shots", shotIds? }`. Voice the lines (one daily `tts`; handle of kind `scene`) or have AI suggest shot prompts (free, waits up to about 90 seconds). Super-admin keys only. |
| `scene_script_shots` | `{ id, only?, estimateOnly?, confirmOverBenchmark? }`. Paid AI clips for the shots; the estimate's dollars are charged to the daily `aiVideoUsd` cap first. Handle of kind `scene`. Super-admin keys only. |
| `scene_script_render` | `{ id }`. Render once every line is voiced and every shot has a clip. Handle of kind `scene`. One daily render. Never posts. Super-admin keys only. |
| `scene_script_cancel` | `{ id, what: "shots" or "render" }`. Stop ordering clips, or stop the render. Super-admin keys only. Free. |
| `series_project` | `{ action: "list" or "preview", ... }`. Your series, or the plan for one Bible passage (how many parts, which verses). Free. |
| `series_generate` | `{ reference, versesPerPart?, durationSec?, destination?, ... }`. Make and post one short per part, each a job of kind `job`. Needs publish consent; per part one daily render, one daily publish and one plan `render` quota. |
| `longform_project` | `{ action: "templates" or "draft" or "sections" or "reopen", ... }`. 30 and 60 minute sleep sessions: draft an outline from your script, an idea or a voice note (one daily render and one plan `render` quota), edit it, reopen a failed one. |
| `longform_narrate` | `{ id, voiceId? }`. Voice the outline, then cut scenes and make pictures. Handle of kind `longform`. One daily `tts` per section, daily `images` for the pictures, one plan `render` quota. |
| `gumroad` | `{ action: "generate" or "history", freeTitle?, paidTitle?, limit? }`. The free ebook and paid devotional as markdown, plus a sign-in zip link. Listed only when your plan has the Gumroad feature. Free. |
| `queue_items` | `{ action: "list" or "add" or "remove" or "clear", item?, id? }`. Your content queue of post ideas. `clear` deletes every item. Free. |
| `social_status` | Where you can publish: YouTube, playlists, auto-publish destinations, Buffer profiles, saved webhooks and schedules. No secrets. Free. |
| `publish_youtube` | `{ videoPath, title, ... }`. Upload to the connected channel. Handle of kind `publish`. Needs publish consent; one daily publish. |
| `publish_post` | `{ destination: "webhook" or "buffer", videoPath, caption, ... }`. Post to a saved webhook (and TikTok when connected) or Buffer. Needs publish consent; one daily publish. |
| `youtube_thumbnail` | `{ videoId, thumbnailPath }`. Replace a YouTube video's thumbnail. Needs publish consent; no daily publish. |
| `schedules` | `{ action: "list" or "create" or "remove", ... }`. Recurring posts, at most hourly. `create` and `remove` need publish consent; `create` is one daily publish (at most 5 agent-made schedules per account); `remove` only removes a schedule an agent created. |
| `autopublish_run` | One-click Auto-Publish: script, voice, render and post in one job (kind `job`). Needs publish consent; one daily render and one daily publish. |

That is the whole catalogue. Each tool's own description (in `tools/list`) has its full options and costs.

## Getting media in

Tools take a **server-side path**, not a file. Get a file onto the server, then pass the path it returns. A file you already uploaded in the app is in `media_list`.

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

## Resources

Besides tools, the server offers three resources (`resources/read`), all served with LF line endings:

| URI | What it holds |
|---|---|
| `biblefuel://guide` | The agent part of this guide, as Markdown: first calls, job handles, pipelines, costs and troubleshooting. Read it before the first call if your client gives the agent no instructions. |
| `biblefuel://guide/setup` | This setup part: keys, client config, the full tool table, getting media in, resources and prompts. |
| `biblefuel://jobs/{kind}/{id}` | One job handle, as JSON (`application/json`). |

The job resource is the handle `jobs_wait` returns, read once without waiting; for kind `job` it is exactly what `jobs_get` returns. `kind` and `id` are the ones on the handle the starting tool returned, for example `biblefuel://jobs/job/job_ab12cd` or `biblefuel://jobs/story/<project id>`. A `lyric_render` also needs the song: `biblefuel://jobs/lyric_render/<job id>?projectId=<song id>`.

A read is free and charges no cap. It is not written to the activity log; the server logs one line per read (key, kind and outcome). It is checked like the tools: an unknown kind fails with `BAD_KIND`, a `lyric_render` without `projectId` with `BAD_INPUT`, and a job that is not yours reads exactly like one that does not exist (`HTTP_404`), except kind `captioned`, whose status route answers `HTTP_403` ("job belongs to another user") for someone else's job; `jobs_wait` gets the same answers. A refused read is an MCP (JSON-RPC) error, not a tool result. Its code is -32602 when the read is refused, and -32603 when the server failed (`INTERNAL`, or a 5xx answer from the app). The SDK puts its own prefix on the message, for example `MCP error -32602: BAD_KIND: Unknown job kind "nope". ...` (some clients show the prefix twice), so do not split the message: branch on `data.error`, and read `data.message`, `data.hint` and `data.status`. `resources/list` shows only the two guide resources: the template does not list your jobs (use `jobs_list`, or a feature's project tool with `action: "list"`).

## Prompts

Three prompts (`prompts/get`) hand an agent a ready-made, ordered step list for a common job: the exact tools to call, what to pass from one step to the next (job handles go to `jobs_wait`), and where a cap or missing consent stops the run. Every key sees all three, and they use only tools every key has. Prompt arguments are strings.

| Prompt | Arguments | Use it when |
|---|---|---|
| `make_short_from_verse` | `reference` (required, for example `John 3:16`), `voice` (a voice name from `voice_list`), `publish` (`"true"` or `"false"`, default false) | The user wants a short captioned video of one verse: `bible_lookup`, `voice_synthesize`, `render_short`, `jobs_wait`. With fewer than four daily `images` left it uses a saved or stock background (`library_items`, `backgrounds_search`) instead of `autoBackground`. With `publish` `"true"` it reads `social_status` before anything is spent: when the user's auto-publish is on for YouTube, the render posts itself and the prompt stops there (an upload as well would post the video twice); otherwise it adds `publish_youtube` and a second `jobs_wait` (with auto-publish on for other platforms only, that is two publishes). Publishing needs publish consent (`PUBLISH_NOT_ALLOWED` otherwise). One daily render, one `tts` and four `images`, plus one publish when publishing. |
| `make_ambient_session` | `theme`, `hours` (more than 0, at most 10; default 2) | The user wants a long, music-first scripture video: `ambient_project`, `ambient_plan`, `music_library`, `ambient_update`, `ambient_step` (voice, then images), `ambient_render`. Each verse (one per fifteen minutes) costs one daily `tts` and one daily `images`, so a long session can need more than one day of caps; `whoami` must also show one render left. Never posts. |
| `make_lyric_video` | `songPath` (required: a file in your media folder, or a public URL to import first) | The user has a song and its lyrics: `lyric_project`, `lyric_set_song`, `lyric_set_lyrics`, `lyric_align`, `lyric_render`. Two daily renders in all, plus one daily `imports` when `songPath` is a URL; `whoami` must show them before the first paid step. The agent asks the user for the lyrics and never invents them. Never posts. |

A missing required argument, or a bad one (`hours` `"11"`, `publish` `"maybe"`), is refused with JSON-RPC code -32602. The prompts are a starting point: the Pipelines section and each tool's own description have the other options.

Claude Code offers the prompts as slash commands (`/mcp__biblefuel__make_short_from_verse`) and splits the arguments on spaces, quotes or not. `make_short_from_verse` puts a reference split that way back together (`Romans 8:28` arriving as `Romans` and `8:28`), but a reference of three words or more (`1 John 4:8`) fills the `publish` argument and is refused. Ask in plain words instead, for example "make a short of 1 John 4:8". Codex has no prompts: ask in plain words, and the agent can follow the step list in this guide.
