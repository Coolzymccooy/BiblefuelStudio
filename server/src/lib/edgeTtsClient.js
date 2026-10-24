import crypto from "node:crypto";
import WebSocket from "ws";

/**
 * Minimal client for Microsoft Edge's "Read Aloud" speech service (#120).
 *
 * Why not msedge-tts: 2.0.5 still dials the old speech.platform.bing.com socket, which now
 * answers 403 (it wants the newer "v2" Sec-MS-GEC token). 2.1.0 moved to the msedgeservices
 * endpoint below, but it leaves out the Accept-Encoding and Accept-Language headers, and
 * without them that endpoint answers a plain HTTP 200 instead of upgrading. It hard-codes its
 * headers, so the fix is this small client with the full browser header set.
 *
 * Unofficial API: Microsoft can change it at any time. EDGE_TTS_ENABLED=false turns Edge off.
 */

export const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
export const EDGE_WSS_URL = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1";
const CHROMIUM_FULL_VERSION = "143.0.3650.96";
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split(".")[0];
export const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
export const EDGE_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

/** Seconds from 1601-01-01 (Windows file time) to 1970-01-01. */
const WIN_EPOCH_SECONDS = 11644473600n;
const DEFAULT_TIMEOUT_MS = 20_000;
/** A server clock this far from ours is treated as skew worth correcting. */
const SKEW_TOLERANCE_MS = 60_000;
const MAX_ATTEMPTS = 3;
/** Pause before retrying a 429, multiplied by the attempt number. */
const RETRY_DELAY_MS = 1_000;

/** Corrects the token's clock when the service says ours is off (learned from a 403's Date). */
let clockSkewMs = 0;

/**
 * Sec-MS-GEC: SHA-256 (upper-case hex) of the current Windows file time, rounded down to a
 * 5-minute window and expressed in 100 ns ticks, followed by the trusted client token.
 *
 * @param {number} [nowMs] Unix time in milliseconds
 */
export function secMsGec(nowMs = Date.now()) {
  let seconds = BigInt(Math.floor(nowMs / 1000)) + WIN_EPOCH_SECONDS;
  seconds -= seconds % 300n;
  const ticks = seconds * 10_000_000n;
  return crypto.createHash("sha256").update(`${ticks}${TRUSTED_CLIENT_TOKEN}`, "ascii").digest("hex").toUpperCase();
}

const newId = () => crypto.randomUUID().replace(/-/g, "");

/** The socket URL for one connection. */
export function edgeSynthUrl({ nowMs = Date.now(), connectionId = newId() } = {}) {
  const query = new URLSearchParams({
    "Ocp-Apim-Subscription-Key": TRUSTED_CLIENT_TOKEN,
    "Sec-MS-GEC": secMsGec(nowMs),
    "Sec-MS-GEC-Version": SEC_MS_GEC_VERSION,
    ConnectionId: connectionId,
  });
  return `${EDGE_WSS_URL}?${query}`;
}

/** Headers the Edge browser sends; the service refuses the upgrade without them. */
export function edgeHandshakeHeaders() {
  return {
    "User-Agent":
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
      `Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

const XML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const escapeXml = (value) => String(value).replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);

/** One <speak> document. Text and attributes are escaped, so a stray "&" cannot break it. */
export function buildSsml({ text, voice, rate = "+0%", pitch = "+0Hz", volume = "+0%" }) {
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
    `<voice name="${escapeXml(voice)}">` +
    `<prosody pitch="${escapeXml(pitch)}" rate="${escapeXml(rate)}" volume="${escapeXml(volume)}">` +
    `${escapeXml(text)}</prosody></voice></speak>`
  );
}

/** The JavaScript Date string the browser puts in X-Timestamp. */
const timestamp = () => new Date().toString();

function speechConfigMessage() {
  const config = {
    context: {
      synthesis: {
        audio: {
          metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
          outputFormat: EDGE_OUTPUT_FORMAT,
        },
      },
    },
  };
  return (
    `X-Timestamp:${timestamp()}\r\nContent-Type:application/json; charset=utf-8\r\n` +
    `Path:speech.config\r\n\r\n${JSON.stringify(config)}\r\n`
  );
}

function ssmlMessage(requestId, ssml) {
  return (
    `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${timestamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`
  );
}

/** Splits a binary frame: 2-byte big-endian header length, the headers, then the audio. */
function parseBinaryFrame(buffer) {
  if (buffer.length < 2) return null;
  const headerLength = buffer.readUInt16BE(0);
  if (2 + headerLength > buffer.length) return null;
  const headers = buffer.subarray(2, 2 + headerLength).toString("utf-8");
  return { headers, audio: buffer.subarray(2 + headerLength) };
}

const pathOf = (headers) => /Path:([^\r\n]+)/.exec(headers)?.[1]?.trim();

const createWsSocket = (url, options) => new WebSocket(url, options);

class HandshakeError extends Error {
  constructor(status, serverDate) {
    super(`Edge TTS handshake refused: HTTP ${status}`);
    this.status = status;
    this.serverDate = serverDate;
  }
}

/** One connection, one synthesis. Resolves with the MP3 bytes. */
function synthesizeOnce({ ssml, createSocket, timeoutMs, nowMs }) {
  return new Promise((resolve, reject) => {
    const requestId = newId();
    const chunks = [];
    let settled = false;
    const socket = createSocket(edgeSynthUrl({ nowMs }), { headers: edgeHandshakeHeaders() });

    const finish = (error, audio) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      if (error) reject(error);
      else resolve(audio);
    };
    const timer = setTimeout(
      () => finish(new Error(`Edge TTS timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );

    socket.on("unexpected-response", (request, response) => {
      const error = new HandshakeError(response?.statusCode, response?.headers?.date);
      try { response.resume?.(); } catch { /* drain best-effort */ }
      try { request.destroy?.(); } catch { /* best-effort */ }
      finish(error);
    });
    socket.on("error", (err) => finish(new Error(`Edge TTS socket error: ${err?.message || err}`)));
    socket.on("close", (code, reason) => {
      // An unknown voice, for one, closes the socket with a code and a reason.
      const why = [code, String(reason || "").trim()].filter(Boolean).join(" ");
      finish(new Error(`Edge TTS connection closed before the audio finished${why ? ` (${why})` : ""}`));
    });
    socket.on("open", () => {
      socket.send(speechConfigMessage());
      socket.send(ssmlMessage(requestId, ssml));
    });
    socket.on("message", (data, isBinary) => {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (isBinary) {
        const frame = parseBinaryFrame(buffer);
        if (frame && pathOf(frame.headers) === "audio" && frame.audio.length > 0) chunks.push(frame.audio);
        return;
      }
      if (pathOf(buffer.toString("utf-8")) !== "turn.end") return;
      const audio = Buffer.concat(chunks);
      if (audio.length === 0) finish(new Error("Edge TTS returned no audio"));
      else finish(null, audio);
    });
  });
}

/** How far the server's Date header is from our clock, when it is far enough to matter. */
function skewFrom(serverDate, clientNowMs) {
  const serverMs = Date.parse(serverDate || "");
  if (!Number.isFinite(serverMs)) return null;
  const skew = serverMs - clientNowMs;
  return Math.abs(skew) > SKEW_TOLERANCE_MS ? skew : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether a refused handshake is worth another try. A 429 (the service throttles bursts of
 * connections) is; so is a 403 whose Date header shows our clock is off, after correcting it.
 */
function retryable(err, clientNowMs) {
  if (!(err instanceof HandshakeError)) return false;
  if (err.status === 429) return true;
  if (err.status !== 403) return false;
  const skew = skewFrom(err.serverDate, clientNowMs);
  if (skew === null) return false;
  clockSkewMs += skew;
  return true;
}

/**
 * Speak `text` with an Edge voice. Resolves with MP3 bytes (24 kHz, 48 kbit/s, mono).
 * At most MAX_ATTEMPTS connections; see retryable() for which refusals are retried.
 *
 * @param {{ text: string, voice: string, rate?: string, pitch?: string, volume?: string,
 *   timeoutMs?: number, retryDelayMs?: number, createSocket?: Function, now?: () => number }} opts
 *   `createSocket(url, options)`, `now()` and `retryDelayMs` are test seams.
 * @returns {Promise<Buffer>}
 */
export async function edgeSynthesize({
  text,
  voice,
  rate,
  pitch,
  volume,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelayMs = RETRY_DELAY_MS,
  createSocket = createWsSocket,
  now = Date.now,
}) {
  const ssml = buildSsml({ text, voice, rate, pitch, volume });
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await synthesizeOnce({ ssml, createSocket, timeoutMs, nowMs: now() + clockSkewMs });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !retryable(err, now() + clockSkewMs)) throw err;
      if (err.status === 429) await sleep(retryDelayMs * attempt);
    }
  }
}
