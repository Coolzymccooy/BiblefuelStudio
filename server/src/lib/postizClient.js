import fetch from "node-fetch";

/**
 * Thin Postiz HTTP client.
 *
 * Postiz is the self-hosted social-media bridge (https://github.com/gitroomhq/postiz-app).
 * The operator runs ONE Postiz instance for the whole Biblefuel deployment.
 * Each Biblefuel user maps 1:1 to a Postiz user via Postiz's "team" API; the
 * connection between the two is the user's POSTIZ_USER_ID stored in their
 * social.json. OAuth flows happen in the Postiz UI — Biblefuel just deep-links
 * the user into the right Postiz screen.
 *
 * Required env:
 *   POSTIZ_URL              e.g. "https://postiz.tiwaton.co.uk"
 *   POSTIZ_API_KEY          server-side admin API key (issued from Postiz)
 *
 * Spec: docs/superpowers/specs/2026-05-26-public-multitenancy-design.md §Phase 4
 * Research: same doc, Appendix A.
 */

export function isPostizConfigured() {
  return Boolean(
    String(process.env.POSTIZ_URL || "").trim() &&
    String(process.env.POSTIZ_API_KEY || "").trim()
  );
}

function baseUrl() {
  const raw = String(process.env.POSTIZ_URL || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("POSTIZ_URL not configured");
  return raw;
}

function authHeaders() {
  const key = String(process.env.POSTIZ_API_KEY || "").trim();
  if (!key) throw new Error("POSTIZ_API_KEY not configured");
  return {
    "Authorization": key.startsWith("Bearer ") ? key : `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function postizRequest(method, path, body) {
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const init = { method, headers: authHeaders() };
  if (body !== undefined) init.body = JSON.stringify(body);
  const resp = await fetch(url, init);
  const text = await resp.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }
  if (!resp.ok) {
    const err = json?.error || json?.message || text || resp.statusText;
    const e = new Error(`Postiz ${resp.status}: ${err}`);
    e.status = resp.status;
    e.body = json || text;
    throw e;
  }
  return json;
}

/**
 * Return the Postiz-hosted "connect <platform>" URL for the given Biblefuel
 * user. The user is redirected there, completes OAuth in Postiz, and Postiz
 * stores the credentials internally.
 *
 * Note: Postiz's exact endpoint shape varies between releases. This client
 * targets the public /integrations API. If your Postiz instance is older,
 * map the endpoint here without touching the route file.
 *
 * @param {'tiktok'|'youtube'|'instagram'|'x'|'facebook'|'linkedin'|'threads'|'pinterest'|'reddit'|'bluesky'} platform
 * @param {string} postizUserId
 * @param {string} returnUrl   where Postiz should send the user after OAuth
 */
export async function getConnectUrl(platform, postizUserId, returnUrl) {
  if (!postizUserId) throw new Error("postizUserId required");
  return postizRequest("POST", "/api/integrations/connect", {
    identifier: platform,
    userId: postizUserId,
    returnUrl,
  });
}

/**
 * List a user's connected Postiz integrations.
 */
export async function listIntegrations(postizUserId) {
  if (!postizUserId) throw new Error("postizUserId required");
  return postizRequest("GET", `/api/users/${encodeURIComponent(postizUserId)}/integrations`);
}

/**
 * Disconnect a platform for a user (Postiz revokes the OAuth grant).
 */
export async function disconnectIntegration(postizUserId, integrationId) {
  if (!postizUserId) throw new Error("postizUserId required");
  if (!integrationId) throw new Error("integrationId required");
  return postizRequest("DELETE", `/api/users/${encodeURIComponent(postizUserId)}/integrations/${encodeURIComponent(integrationId)}`);
}

/**
 * Provision a Postiz user for a Biblefuel user, if one doesn't exist.
 * Idempotent: callable on every sign-in, returns the Postiz user id either way.
 */
export async function ensurePostizUser({ biblefuelUserId, email }) {
  if (!biblefuelUserId) throw new Error("biblefuelUserId required");
  return postizRequest("POST", "/api/users/upsert", {
    externalId: String(biblefuelUserId),
    email: email || undefined,
    source: "biblefuel",
  });
}

/**
 * Push a finished video to one or more of the user's connected destinations.
 *
 * @param {object} args
 * @param {string} args.postizUserId
 * @param {string} args.videoUrl       publicly accessible URL of the rendered MP4
 * @param {string} args.caption
 * @param {string[]} args.platforms    subset of connected platforms; empty = all
 * @param {string} [args.title]
 */
export async function postVideo({ postizUserId, videoUrl, caption, platforms, title }) {
  if (!postizUserId) throw new Error("postizUserId required");
  if (!videoUrl) throw new Error("videoUrl required");
  return postizRequest("POST", "/api/posts", {
    userId: postizUserId,
    media: [{ url: videoUrl, type: "video" }],
    text: caption || "",
    title: title || undefined,
    integrations: Array.isArray(platforms) && platforms.length > 0 ? platforms : undefined,
    publish: "now",
  });
}
