# Vocal removal ("Make instrumental")

## What it does

"Make instrumental" in the music library removes the vocals from a track using an AI
separation model running on this laptop, then saves the result as a new track in the
library. Both quality options use MDX-Net Inst HQ3 (`UVR-MDX-NET-Inst_HQ_3.onnx`), a
model trained to output the instrumental directly. **Best** runs it at its default
overlap; **Fast** passes `--mdx_overlap 0.1` — a little quicker, a little rougher at
the seams.

The song is first decoded to WAV with ffmpeg: the separator reads audio through
libsndfile, which cannot open m4a/AAC (it fails with "Format not recognised").

**Models ruled out on this laptop (2026-09-25):** BS-Roformer
(`model_bs_roformer_ep_317_sdr_12.9755.ckpt`) is cleaner but took 4m38s for a 20 s
clip on the CPU — about an hour for a 4-minute song. Demucs (`htdemucs.yaml`) has no
"Instrumental" stem, so `--single_stem Instrumental` writes nothing.

## One-time setup (Windows)

1. Create a dedicated Python virtual environment (don't reuse another project's venv —
   `audio-separator`'s dependencies are heavy and can conflict):

   ```
   py -3.12 -m venv C:\Users\segun\.biblefuel\stems-venv
   ```

2. Install the separator and `audioread`:

   ```
   C:\Users\segun\.biblefuel\stems-venv\Scripts\python.exe -m pip install "audio-separator[cpu]" audioread
   ```

   `audioread` is required even though `audio-separator` doesn't list it: librosa 1.0
   no longer installs `audioread` itself, and without it the CLI crashes with
   `ModuleNotFoundError: audioread`.

3. In `server/.env`, point the server at the venv's CLI executable:

   ```
   STEMS_CLI=C:\Users\segun\.biblefuel\stems-venv\Scripts\audio-separator.exe
   STEMS_MODEL_DIR=C:\Users\segun\.biblefuel\models   # optional — where downloaded models are cached
   ```

4. Restart the server so it picks up the new `.env` values.

The first time the model is used, `audio-separator` downloads it (~65 MB) —
expect a pause on that first run.

**Call the `.exe`, not the module.** `python -m audio_separator.utils.cli` exits 0
without doing anything; `STEMS_CLI` must point at the venv's `audio-separator.exe`.

## Verified environment (2026-09-24)

Confirmed working on this laptop: `audio-separator` 0.47.0, `torch` 2.14.0,
`onnxruntime` 1.30.0, on Python 3.12.10. `ffmpeg -encoders` lists `h264_amf` (the AMD
graphics-chip encoder) on this laptop.

## Timing and memory (measured on this laptop)

| | Time per 4-min song | Peak RAM |
|---|---|---|
| Best (MDX-Net Inst HQ3) | ~3–4 min (measured 16 s separation for a 20 s clip) | not measured yet |
| Fast (MDX-Net Inst HQ3, overlap 0.1) | ~2.5 min (measured: 6:49 song in 3m40s end to end) | not measured yet |
| Graphics-chip encode (h264_amf) | not measured yet — first real run pending | not measured yet — first real run pending |

Timings are scaled from a 20 s clip of a real song on the CPU (Ryzen 7 8840HS); a full
song adds a few seconds of model loading and the AAC encode.

## What quality to expect

Separation quality depends heavily on the source recording:

- **Studio lead vocal** (clean single voice, produced track) — very good.
- **Worship with backing vocals** — good; faint vocal bleed can remain in loud choruses.
- **Choir-heavy gospel** — fair; this is the hardest case for the model.
- **Live recordings** — poor; crowd noise and room bleed confuse the separator.
- **Low-bitrate or YouTube-rip sources** — noticeably worse than a clean original at
  any of the above levels.

## One heavy job at a time

Vocal separation and video rendering share the same "one heavy job at a time" limit: a
separation waits for a render to finish, and a render waits for a separation to finish.
The UI shows "Waiting for another job to finish…" for whichever job is queued.

## Licence rule

An instrumental keeps the original track's licence status and credit — it is a
derived track, not a new, independently-cleared one. Separating a song does not clear
it for YouTube use by itself; the same licence gate that applies to the original bed
track still applies to its instrumental.

## Forgetting a kept instrumental

"Forget" only removes a track from the music index — it never deletes the file (see
`docs/music-library.md`, Instrumentals). A kept instrumental is exempt from the 7-day
sweep only while it stays referenced by the index; "Forget" it and that exemption ends
— its file becomes eligible for the same 7-day sweep as any other leftover separation
output, the next time a separation job starts.

## First real run checklist

- [ ] Fill in the timing/memory table above with real numbers (see "Timing and memory").
- [ ] After a **Cancel**, confirm no `python.exe` from the stems venv is left running
      (Task Manager or `Get-Process python -ErrorAction SilentlyContinue`) — a
      separation that ignored the cancel and kept the process alive would otherwise go
      unnoticed until it finished or something else needed that CPU.

## On the live site: the laptop does it

The deployed server has no separator (no Python venv, no spare CPU), so it hands the
work to this laptop. "Remove vocals" appears on the live site whenever the server has a
worker key; the request waits in a queue until the laptop picks it up, and the
instrumental lands in the live library as usual. Requests made while the laptop is off
wait (they survive a deploy) and run when it is back.

### One-time setup

1. Make a key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. In Coolify, add it to the Biblefuel app's environment as `STEMS_WORKER_TOKEN`, and
   redeploy. (The server refuses the worker routes until this is set, and ignores a key
   shorter than 32 characters.)
3. On the laptop, add the same line to `server/.env`: `STEMS_WORKER_TOKEN=<the key>`.
   `BIBLEFUEL_URL` defaults to `https://biblefuel.tiwaton.co.uk`.
4. Try it: `cd server && npm run stems-worker`. It prints "removing vocals for …" and
   waits. The live site's dialog now says "Waiting for your laptop…" rather than
   "offline" while it runs.
5. Start it at every log-on (current user, no admin needed):
   `powershell -ExecutionPolicy Bypass -File server\scripts\install-stems-worker.ps1`.
   Its output goes to `server/stems-worker.log`. Remove it with
   `Unregister-ScheduledTask -TaskName "Biblefuel vocal removal" -Confirm:$false`.

### How it behaves

- One job at a time. The laptop checks in every 5 seconds; the site shows it offline
  after 45 seconds without a check-in.
- A claimed job is leased for 3 minutes and renewed while it runs. If the laptop sleeps
  mid-job, the lease lapses and the job goes back in the queue; after 3 attempts it
  fails with a message.
- Cancel in the dialog stops the laptop at its next progress report; a late result is
  refused.
- The worker key only reaches `/api/stems-worker`: it can fetch the song of a job it
  holds and upload that job's result (checked to be real M4A audio, named by the server).

## Without a worker key

With neither `STEMS_CLI` nor `STEMS_WORKER_TOKEN` set, the server answers that vocal
removal is unavailable and "Remove vocals" does not appear.
