/**
 * The "direct" social settings (YouTube OAuth app, Instagram and TikTok
 * tokens) hold secrets. readSocialStore also fills the operator's env
 * YOUTUBE_CLIENT_SECRET into EVERY user's copy, so returning `direct` as it
 * is handed the operator's OAuth client secret to anyone signed in.
 *
 * The browser gets the non-secret fields and a has<Secret> flag for each
 * secret. On save, a blank secret means "keep what is stored", because the
 * page never had it to send back.
 */

const SECRETS = {
  youtube: ["clientSecret", "refreshToken"],
  instagram: ["accessToken"],
  tiktok: ["accessToken"],
};

const flag = (field) => `has${field[0].toUpperCase()}${field.slice(1)}`;
const present = (v) => String(v ?? "").trim().length > 0;

/**
 * @param {object} direct store.direct
 * @returns {object} the same shape with every secret removed and a has<Secret> flag in its place
 */
export function publicDirectConfig(direct = {}) {
  const out = {};
  for (const [platform, secrets] of Object.entries(SECRETS)) {
    const section = { ...(direct?.[platform] || {}) };
    for (const field of secrets) {
      section[flag(field)] = present(section[field]);
      delete section[field];
    }
    out[platform] = section;
  }
  return out;
}

/**
 * @param {object|undefined} incoming direct from the request (secrets may be blank)
 * @param {object} current store.direct
 * @returns {object} incoming, with each blank secret taken from current
 */
export function mergeDirectSecrets(incoming, current = {}) {
  if (!incoming || typeof incoming !== "object") return current || {};
  const out = {};
  for (const platform of Object.keys(SECRETS)) {
    const next = incoming[platform];
    const prev = current?.[platform] || {};
    if (!next || typeof next !== "object") { out[platform] = prev; continue; }
    const section = { ...prev, ...next };
    for (const field of SECRETS[platform]) {
      if (!present(next[field])) section[field] = prev[field] ?? "";
      delete section[flag(field)];
    }
    out[platform] = section;
  }
  return out;
}
