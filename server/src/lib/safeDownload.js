import dns from "node:dns";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import fetch from "node-fetch";

/**
 * SSRF-hardened download of a user-supplied URL.
 *
 * Guards: http(s) only; the hostname is resolved by us and every address is
 * vetted with isPublicAddress; the socket is then PINNED to that vetted
 * address (so a second DNS answer cannot redirect the connection); redirects
 * are followed by hand and each hop is vetted again; the body is capped.
 *
 * Failures are Errors whose message is a machine code (URL_TIMEOUT: overall
 * deadline or a stalled body):
 *   URL_SCHEME, URL_PRIVATE, URL_REDIRECTS, URL_TOO_LARGE, URL_TIMEOUT.
 * Anything else (HTTP errors, network errors) carries a plain message.
 * URL_TOO_LARGE caused by a declared Content-Length carries `declaredBytes`.
 */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function codedError(code, extra = {}) {
  return Object.assign(new Error(code), { code }, extra);
}

/** Codes that mean "this URL is refused", as opposed to a network failure. */
const GUARD_CODES = new Set(["URL_SCHEME", "URL_PRIVATE", "URL_REDIRECTS", "URL_TOO_LARGE"]);

const GUARD_SENTENCES = {
  URL_SCHEME: "Only http and https links can be used.",
  URL_PRIVATE: "That link points to a private or internal address, which is not allowed.",
  URL_REDIRECTS: "That link redirected too many times.",
  URL_TOO_LARGE: "That file is larger than the size limit.",
};

/**
 * True when `err` is a refusal (bad scheme, private address, redirect loop,
 * oversized file). Refusals must not be retried: the answer will not change.
 * URL_TIMEOUT is deliberately NOT a refusal.
 */
export function isUrlGuardError(err) {
  return Boolean(err && GUARD_CODES.has(err.code));
}

/** "<code>: <plain sentence>" for a refusal, else null. */
export function urlGuardMessage(err) {
  return isUrlGuardError(err) ? `${err.code}: ${GUARD_SENTENCES[err.code]}` : null;
}

// ---------------------------------------------------------------- addresses

function parseIPv4(text) {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every((n) => n >= 0 && n <= 255) ? octets : null;
}

function isPublicIPv4(octets) {
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // shared address space
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** Expand an IPv6 literal to eight 16-bit groups, or null when malformed. */
function parseIPv6(text) {
  let body = text.split("%")[0]; // drop a zone id
  const dotted = body.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const v4 = parseIPv4(dotted[1]);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    body = `${body.slice(0, body.length - dotted[1].length)}${hi}:${lo}`;
  }
  const halves = body.split("::");
  if (halves.length > 2) return null;
  const toGroups = (s) => (s === "" ? [] : s.split(":"));
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const values = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return values.length === 8 && values.every((n) => Number.isInteger(n)) ? values : null;
}

function isPublicIPv6(groups) {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const lowZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (lowZero && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return false; // :: and ::1
  if ((g0 & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return false; // multicast
  if (isIPv4TunnelOrLocalUse(groups)) return false;
  const embedded = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
  // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), 64:ff9b::a.b.c.d (NAT64)
  if (lowZero && (g5 === 0xffff || g5 === 0)) return isPublicIPv4(embedded);
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPublicIPv4(embedded);
  }
  // 2002::/16 6to4: the IPv4 gateway sits in groups 1-2.
  if (g0 === 0x2002) return isPublicIPv4([g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff]);
  return true;
}

/**
 * Ranges that never name a public host directly: ::ffff:0:a.b.c.d
 * (IPv4-translated, SIIT), 2001:0::/32 (Teredo), 64:ff9b:1::/48 (local-use
 * NAT64) and 2001:db8::/32 (documentation).
 */
function isIPv4TunnelOrLocalUse([g0, g1, g2, g3, g4, g5]) {
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) return true;
  if (g0 === 0x2001 && g1 === 0) return true;
  if (g0 === 0x2001 && g1 === 0xdb8) return true;
  return g0 === 0x64 && g1 === 0xff9b && g2 === 1;
}

/**
 * True only for an address that is routable on the public internet.
 * Non-IP input is false.
 * @param {string} ip
 * @returns {boolean}
 */
export function isPublicAddress(ip) {
  const text = String(ip ?? "").trim();
  const family = isIP(text);
  if (family === 4) {
    const octets = parseIPv4(text);
    return octets ? isPublicIPv4(octets) : false;
  }
  if (family === 6) {
    const groups = parseIPv6(text);
    return groups ? isPublicIPv6(groups) : false;
  }
  return false;
}

// ------------------------------------------------------------------ helpers

/** An agent whose DNS lookup always answers with the already-vetted address. */
function pinnedAgentFor(address, family, protocol) {
  const lookup = (_host, options, callback) => {
    // Node 20+ asks for every address (`all: true`) when auto-selecting a family.
    if (options && options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
  return protocol === "https:"
    ? new https.Agent({ lookup, keepAlive: false })
    : new http.Agent({ lookup, keepAlive: false });
}

function parseHttpUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw codedError("URL_SCHEME");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw codedError("URL_SCHEME");
  return parsed;
}

/**
 * Resolve and vet the host of `parsed`; returns the address to pin to.
 * `unvettedHosts` (tests only) lists hostnames whose resolved address is
 * trusted without the public-address check.
 */
async function resolveVettedAddress(parsed, lookup, unvettedHosts) {
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw codedError("URL_PRIVATE");
    return { address: host, family: isIP(host) };
  }
  const resolved = await lookup(host);
  const address = String(resolved?.address ?? "");
  const family = Number(resolved?.family) || isIP(address);
  if (!unvettedHosts.has(host) && !isPublicAddress(address)) throw codedError("URL_PRIVATE");
  if (!address || !family) throw codedError("URL_PRIVATE");
  return { address, family };
}

/** Every address `lookup` gives for `host`, whatever shape it answers in. */
async function resolveAll(host, lookup) {
  const answer = await lookup(host, { all: true });
  const list = Array.isArray(answer) ? answer : [answer];
  return list.map((entry) => String(entry?.address ?? "")).filter(Boolean);
}

/**
 * Vet a URL that is handed onward (to ffmpeg, a webhook POST) rather than
 * downloaded here. http(s) only (URL_SCHEME); the host must resolve, and EVERY
 * address it resolves to must be public (URL_PRIVATE). Returns the parsed URL.
 *
 * Unlike downloadPublicUrl this cannot pin the later connection, so a host
 * whose DNS changes between this check and the request is not covered; callers
 * that can download instead should use downloadPublicUrl.
 *
 * @param {string} url
 * @param {{
 *   lookup?: (host: string, opts: { all: true }) => Promise<any>,
 *   unvettedHostsForTests?: Iterable<string>,
 * }} [opts] `unvettedHostsForTests` is a test seam, as for downloadPublicUrl.
 * @returns {Promise<URL>}
 */
export async function assertPublicHttpUrl(url, { lookup = dns.promises.lookup, unvettedHostsForTests = [] } = {}) {
  const parsed = parseHttpUrl(String(url ?? ""));
  if (new Set(unvettedHostsForTests).has(parsed.hostname)) return parsed;
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw codedError("URL_PRIVATE");
    return parsed;
  }
  const addresses = await resolveAll(host, lookup);
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw codedError("URL_PRIVATE");
  return parsed;
}

/**
 * One request (a webhook POST, say) to a user-supplied URL, with the same
 * guards as downloadPublicUrl minus the body handling: http(s) only, the host
 * resolved and vetted by us, the socket PINNED to that vetted address (so a
 * DNS answer that changes after the check cannot redirect the connection),
 * redirects returned rather than followed, and an overall deadline.
 *
 * Refusals throw coded errors (URL_SCHEME, URL_PRIVATE). The deadline aborts
 * the request (an AbortError), including a body still being read.
 *
 * @param {string} url
 * @param {object} [init] fetch init (method, headers, body, signal); `redirect`
 *   and `agent` are always overridden.
 * @param {{
 *   lookup?: (host: string) => Promise<{ address: string, family: number }>,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   unvettedHostsForTests?: Iterable<string>,
 * }} [opts] `unvettedHostsForTests` is a test seam; production must never set it.
 * @returns {Promise<Response>}
 */
export async function fetchPublic(url, init = {}, opts = {}) {
  const {
    lookup = dns.promises.lookup,
    fetchImpl = fetch,
    timeoutMs = 15_000,
    unvettedHostsForTests = [],
  } = opts;
  const parsed = parseHttpUrl(String(url ?? ""));
  const { address, family } = await resolveVettedAddress(parsed, lookup, new Set(unvettedHostsForTests));
  const agent = pinnedAgentFor(address, family, parsed.protocol);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (timer.unref) timer.unref();
  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return fetchImpl(parsed.href, { ...init, redirect: "manual", signal: controller.signal, agent: () => agent });
}

function byteCounter(maxBytes, onCount) {
  let total = 0;
  return new Transform({
    transform(chunk, _enc, done) {
      total += chunk.length;
      onCount(total);
      if (total > maxBytes) done(codedError("URL_TOO_LARGE"));
      else done(null, chunk);
    },
  });
}

async function removeQuietly(file) {
  try {
    await fs.promises.rm(file, { force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* best effort: the caller already has the real error */
  }
}

function mediaTypeOf(response) {
  return String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
}

// -------------------------------------------------------------------- main

/**
 * Download a public http(s) URL to `destPath` with SSRF, redirect and size guards.
 *
 * @param {string} url
 * @param {string} destPath
 * @param {{
 *   maxBytes: number,
 *   maxRedirects?: number,
 *   timeoutMs?: number, // overall deadline
 *   idleMs?: number, // abort when no body bytes arrive for this long
 *   lookup?: (host: string) => Promise<{ address: string, family: number }>,
 *   fetchImpl?: typeof fetch,
 *   unvettedHostsForTests?: Iterable<string>,
 * }} opts `unvettedHostsForTests` exists only so tests can reach a loopback
 *   fixture through a fake hostname; production code must never set it.
 * @returns {Promise<{ bytes: number, contentType: string, finalUrl: string, declaredBytes: number }>}
 *   `declaredBytes` is the host's Content-Length, 0 when it did not send one.
 */
export async function downloadPublicUrl(url, destPath, opts) {
  const {
    maxBytes,
    maxRedirects = 3,
    timeoutMs = 60_000,
    idleMs = 30_000,
    lookup = dns.promises.lookup,
    fetchImpl = fetch,
    unvettedHostsForTests = [],
  } = opts || {};
  if (!(maxBytes > 0)) throw new Error("maxBytes is required");
  const unvettedHosts = new Set(unvettedHostsForTests);

  const controller = new AbortController();
  let timedOut = false;
  const abortAsTimeout = () => { timedOut = true; controller.abort(); };
  const timer = setTimeout(abortAsTimeout, timeoutMs);
  let stallTimer = null;
  const armStallTimer = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(abortAsTimeout, idleMs);
  };
  const agents = [];
  try {
    let current = parseHttpUrl(url);
    for (let hop = 0; ; hop += 1) {
      const { address, family } = await resolveVettedAddress(current, lookup, unvettedHosts);
      const agent = pinnedAgentFor(address, family, current.protocol);
      agents.push(agent);
      const response = await fetchImpl(current.href, {
        redirect: "manual",
        signal: controller.signal,
        agent: () => agent,
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        response.body?.destroy?.();
        if (hop >= maxRedirects) throw codedError("URL_REDIRECTS");
        const location = response.headers.get("location");
        if (!location) throw new Error(`redirect (${response.status}) without a Location header`);
        current = parseHttpUrl(new URL(location, current).href);
        continue;
      }

      if (!response.ok || !response.body) {
        response.body?.destroy?.();
        throw new Error(`HTTP ${response.status}`);
      }
      const declared = Number(response.headers.get("content-length"));
      const declaredBytes = Number.isFinite(declared) && declared > 0 ? declared : 0;
      if (declaredBytes > maxBytes) {
        response.body.destroy();
        throw codedError("URL_TOO_LARGE", { declaredBytes });
      }

      let bytes = 0;
      armStallTimer();
      try {
        await pipeline(
          response.body,
          byteCounter(maxBytes, (total) => { bytes = total; armStallTimer(); }),
          fs.createWriteStream(destPath),
        );
      } catch (err) {
        controller.abort();
        await removeQuietly(destPath);
        throw err;
      }
      return { bytes, contentType: mediaTypeOf(response), finalUrl: current.href, declaredBytes };
    }
  } catch (err) {
    if (timedOut || err?.name === "AbortError") throw codedError("URL_TIMEOUT");
    throw err;
  } finally {
    clearTimeout(timer);
    clearTimeout(stallTimer);
    for (const agent of agents) agent.destroy();
  }
}
