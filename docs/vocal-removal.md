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

## Hidden on the deployed server

This feature only appears when `STEMS_CLI` is set. On the deployed server `STEMS_CLI`
is left unset, so "Make instrumental" does not appear — the feature is laptop-only by
design; the deployed server doesn't have a Python venv or spare CPU for it.
