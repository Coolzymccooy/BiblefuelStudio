import { isOwnerCtx } from "../paths.js";

/**
 * Connecting a user's own TikTok through the operator's Zernio account
 * (https://docs.zernio.com/guides/multi-tenant).
 *
 * Every BibleFuel user gets their own Zernio PROFILE (externalId = their user
 * id). A TikTok they connect lands in that profile, and they only ever post
 * to that account. The owner keeps the server-wide ZERNIO_TIKTOK_ACCOUNT_ID.
 *
 * Zernio bills the operator per connected account (first 2 free, then $6 a
 * month each for accounts 3-10), so the connect route is admin-only.
 */

const BASE = "https://zernio.com/api/v1";
const defaultFetch = (...args) => fetch(...args);
let fetchImpl = defaultFetch;

/** Test seam: replace the HTTP client (null restores the real one). */
export function _setZernioFetch(fn) {
  fetchImpl = fn || defaultFetch;
}

export function zernioApiKey() {
  return String(process.env.ZERNIO_API_KEY || "").trim();
}

async function call(path, { method = "GET", query, body, apiKey } = {}) {
  const key = apiKey || zernioApiKey();
  if (!key) throw new Error("Zernio is not set up on this server.");
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
  const resp = await fetchImpl(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!resp.ok) {
    const why = String(json?.error || json?.message || text || "").slice(0, 200);
    const err = new Error(`Zernio ${method} ${path} failed: ${resp.status} ${why}`.trim());
    err.status = resp.status;
    err.details = json?.details || null;
    throw err;
  }
  return json || {};
}

const listOf = (json, key) => (Array.isArray(json?.[key]) ? json[key] : Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []);
const idOf = (x) => String(x?._id || x?.id || "");
const refId = (x) => (x && typeof x === "object" ? idOf(x) : String(x || ""));

/**
 * The user's Zernio profile id, made on first use. Named by user id only: the
 * user's email never leaves BibleFuel.
 *
 * @param {{ userId: string }} user
 * @returns {Promise<string>}
 */
export async function ensureZernioProfile({ userId }) {
  const externalId = String(userId || "").trim();
  if (!externalId) throw new Error("A user id is needed to connect TikTok.");
  const existing = listOf(await call("/profiles", { query: { externalId } }), "profiles")
    .find((p) => String(p?.externalId || "") === externalId);
  if (existing && idOf(existing)) return idOf(existing);
  let created;
  try {
    // The full id in the name: profile names are unique at Zernio, and a
    // shortened id could collide between two users.
    created = await call("/profiles", { method: "POST", body: { name: `BibleFuel user ${externalId}`, externalId } });
  } catch (e) {
    // The profile already exists (an earlier create whose reply was lost):
    // Zernio says which one, so use it instead of failing every retry.
    const existingId = e?.status === 409 ? String(e?.details?.existingProfileId || "") : "";
    if (existingId) return existingId;
    throw e;
  }
  const id = idOf(created?.profile || created);
  if (!id) throw new Error("Zernio did not return a profile id.");
  return id;
}

/** The TikTok sign-in link for this profile; Zernio sends the browser back to redirectUrl. */
export async function tiktokConnectUrl({ profileId, redirectUrl }) {
  const json = await call("/connect/tiktok", { query: { profileId, redirect_url: redirectUrl } });
  const authUrl = String(json?.authUrl || "");
  if (!/^https:\/\//i.test(authUrl)) throw new Error("Zernio did not return a sign-in link.");
  return authUrl;
}

/**
 * The connected TikTok account, but only if Zernio lists it under THIS
 * profile. The callback's accountId comes from the URL, so it is never
 * trusted on its own.
 *
 * @returns {Promise<{ accountId: string, username: string } | null>}
 */
export async function findTikTokAccount({ profileId, accountId }) {
  const wanted = String(accountId || "").trim();
  if (!wanted || !profileId) return null;
  // The server's own TikTok is never anyone else's, whatever Zernio lists.
  if (wanted === String(process.env.ZERNIO_TIKTOK_ACCOUNT_ID || "").trim()) return null;
  const accounts = listOf(await call("/accounts", { query: { profileId } }), "accounts");
  // The account must SAY it is in this profile. An account with no profileId
  // is refused: if Zernio ever ignored the filter, the list would hold every
  // account on the key, and fail-open would hand one user another's TikTok.
  const match = accounts.find((a) => idOf(a) === wanted
    && String(a?.platform || "").toLowerCase() === "tiktok"
    && refId(a?.profileId) === profileId
    && a?.isActive !== false);
  return match ? { accountId: wanted, username: String(match.username || match.displayName || "") } : null;
}

export async function disconnectZernioAccount(accountId) {
  await call(`/accounts/${encodeURIComponent(String(accountId))}`, { method: "DELETE" });
}

/**
 * A Zernio key a user pasted: one token, of a plausible length. Checked
 * before it is ever sent anywhere.
 */
export function cleanZernioKey(raw) {
  const key = String(raw ?? "").trim();
  return /^[A-Za-z0-9_\-.]{16,300}$/.test(key) ? key : "";
}

/**
 * The TikTok accounts on a user's OWN Zernio key (option B: they bring their
 * own Zernio). Everything on that key is theirs, so no profile filter.
 *
 * @param {string} apiKey
 * @returns {Promise<Array<{ accountId: string, username: string }>>}
 */
export async function listOwnTikTokAccounts(apiKey) {
  const accounts = listOf(await call("/accounts", { apiKey }), "accounts");
  return accounts
    .filter((a) => idOf(a) && String(a?.platform || "").toLowerCase() === "tiktok" && a?.isActive !== false)
    .map((a) => ({ accountId: idOf(a), username: String(a.username || a.displayName || "") }));
}

/**
 * Which Zernio key and TikTok account this caller posts with, or null.
 *
 *   1. The owner: the server's key and ZERNIO_TIKTOK_ACCOUNT_ID.
 *   2. Anyone with their own Zernio key and a chosen account: theirs.
 *   3. An admin who connected through the server's Zernio: the server's key,
 *      their own account (written by the connect callback after checking it).
 *
 * Never another person's account: every source after the first is read from
 * the caller's own store.
 *
 * @param {object} ctx  req.ctx or a job ctx
 * @param {object} store the caller's social store
 * @returns {{ apiKey: string, accountId: string, source: "server"|"own_key"|"connected" } | null}
 */
export function tiktokTargetFor(ctx, store) {
  const serverKey = zernioApiKey();
  const serverAccount = String(process.env.ZERNIO_TIKTOK_ACCOUNT_ID || "").trim();
  if (serverKey && serverAccount && isOwnerCtx(ctx)) {
    return { apiKey: serverKey, accountId: serverAccount, source: "server" };
  }
  const own = store?.zernio?.own || {};
  const ownKey = cleanZernioKey(own.apiKey);
  const ownAccount = String(own.accountId || "").trim();
  // A pasted copy of the server's own key is never a user's.
  if (ownKey && ownAccount && ownKey !== serverKey) return { apiKey: ownKey, accountId: ownAccount, source: "own_key" };
  const connected = String(store?.zernio?.tiktok?.accountId || "").trim();
  if (serverKey && connected) return { apiKey: serverKey, accountId: connected, source: "connected" };
  return null;
}

/** The TikTok account id this caller posts to, or null (see tiktokTargetFor). */
export function tiktokAccountFor(ctx, store) {
  return tiktokTargetFor(ctx, store)?.accountId || null;
}
