/**
 * The speech check and speech windows for cartoon clips (spec section 7).
 *
 * A talking clip is generated with a quoted line. Two questions follow, and
 * this module answers both without any paid video model:
 *   - did the clip actually say its line? `transcribeClip` listens to it with
 *     gpt-4o-transcribe and `speechScore` compares what was heard with what was
 *     written (word order matters, punctuation and quote style do not);
 *   - where is the talking? `speechWindows` finds the stretches of the clip
 *     that are not silent, so music can duck under them and captions can be
 *     timed to them.
 *
 * Everything that touches the outside world (ffmpeg, the network, ffprobe) is
 * injected, and the two I/O functions never throw: they return a result or an
 * empty list, so one failed check never stops a render.
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { normaliseForQuote } from "./scripture.js";
import { runFfmpeg } from "../motion/render.js";
import { probeAudioDurationSec } from "../story/storyRender.js";

/** A score at or above this counts as "the clip said its line". */
export const SPEECH_OK = 0.8;

const TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRIBE_MODEL = "gpt-4o-transcribe";
const TRANSCRIBE_TIMEOUT_MS = 120_000;

const SILENCE_FILTER = "silencedetect=noise=-32dB:d=0.35";
/** Speech separated by less than this is one window (a breath, not a pause). */
const MERGE_GAP_SEC = 0.25;
/** Speech shorter than this is a click or a breath, not talking. */
const MIN_WINDOW_SEC = 0.2;

const words = (text) => normaliseForQuote(text).split(" ").filter(Boolean);

/** Length of the longest common subsequence of two word lists. */
function lcsLength(a, b) {
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    }
    prev = row;
  }
  return prev[b.length];
}

/** 0 to 1: how much of the `expected` line was `heard`, by word-level longest common subsequence. */
export function speechScore(expected, heard) {
  const want = words(expected);
  if (want.length === 0) return 1;
  const got = words(heard);
  if (got.length === 0) return 0;
  return lcsLength(want, got) / want.length;
}

function openAiKey() {
  const raw = (process.env.OPENAI_API_KEY || "").replace(/['"]/g, "").trim();
  return !raw || raw.startsWith("your-") ? "" : raw;
}

/**
 * What a thrown error becomes on the clip, which the page shows: one fixed
 * sentence. An error's own text can carry the API key or a temp file path.
 */
const CHECK_FAILED = "The speech check could not run.";

/**
 * What the clip says, as text. Extracts a 16 kHz mono WAV to a temp file (always
 * deleted), then sends it to gpt-4o-transcribe. Never throws.
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string }>}
 */
export async function transcribeClip(file, { ffmpeg = runFfmpeg, fetchImpl = globalThis.fetch, tmpDir = os.tmpdir() } = {}) {
  const key = openAiKey();
  if (!key) return { ok: false, error: "not configured" };
  const wav = path.join(tmpDir, `cartoon-speech-${crypto.randomBytes(6).toString("hex")}.wav`);
  try {
    const made = await ffmpeg(["-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], {});
    if (!made?.ok) return { ok: false, error: "could not extract the clip's audio" };

    const form = new FormData();
    form.append("model", TRANSCRIBE_MODEL);
    form.append("file", new Blob([fs.readFileSync(wav)], { type: "audio/wav" }), "clip.wav");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
    let res;
    try {
      res = await fetchImpl(TRANSCRIBE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return { ok: false, error: `transcription failed (HTTP ${res.status})` };
    const body = await res.json();
    return { ok: true, text: String(body?.text || "").trim() };
  } catch (err) {
    console.warn(`[cartoon] speech check failed: ${String(err?.message || err).split(key).join("[key]")}`);
    return { ok: false, error: CHECK_FAILED };
  } finally {
    try { fs.rmSync(wav, { force: true }); } catch { /* nothing left to clean */ }
  }
}

/** The silences ffmpeg's silencedetect reported, as sorted, merged `{from, to}` pairs; an unfinished one runs to `durationSec`. */
function silencesFrom(stderr, durationSec) {
  const found = [];
  let open = null;
  for (const line of String(stderr || "").split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) { open = Math.max(0, Number(start[1])); continue; }
    const end = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (end && open !== null) { found.push({ from: open, to: Number(end[1]) }); open = null; }
  }
  if (open !== null) found.push({ from: open, to: durationSec });
  const merged = [];
  for (const s of found.sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last && s.from <= last.to) merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, s.to) };
    else merged.push(s);
  }
  return merged;
}

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * Speech windows from silencedetect output: the complement of the silences,
 * bridged when under 0.25 s apart, dropping any under 0.2 s.
 * @returns {{from:number,to:number}[]}
 */
export function parseSilences(stderr, durationSec) {
  const spans = [];
  let cursor = 0;
  for (const s of silencesFrom(stderr, durationSec)) {
    if (s.from > cursor) spans.push({ from: cursor, to: s.from });
    cursor = Math.max(cursor, s.to);
  }
  if (durationSec > cursor) spans.push({ from: cursor, to: durationSec });

  const bridged = [];
  for (const w of spans) {
    const last = bridged[bridged.length - 1];
    if (last && w.from - last.to < MERGE_GAP_SEC) bridged[bridged.length - 1] = { from: last.from, to: w.to };
    else bridged.push({ ...w });
  }
  return bridged
    .filter((w) => w.to - w.from >= MIN_WINDOW_SEC)
    .map((w) => ({ from: round(w.from), to: round(w.to) }));
}

/** Where the clip is talking, as `{from, to}` seconds. Never throws; `[]` when ffmpeg fails or the length is unknown. */
export async function speechWindows(file, { ffmpeg = runFfmpeg, probe = probeAudioDurationSec } = {}) {
  try {
    const ran = await ffmpeg(["-hide_banner", "-nostats", "-i", file, "-vn", "-af", SILENCE_FILTER, "-f", "null", "-"], {});
    if (!ran?.ok) return [];
    let duration = Number(await probe(file));
    if (!Number.isFinite(duration) || duration <= 0) {
      const m = String(ran.stderr || "").match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      duration = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
    }
    if (!(duration > 0)) return [];
    return parseSilences(ran.stderr, duration);
  } catch {
    return [];
  }
}
