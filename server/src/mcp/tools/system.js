import { ApiError } from "../api.js";
import { ok, withoutOk } from "../toolResult.js";
import { accountCapsSummary, capsSummary } from "../../lib/agentKeys/caps.js";

/** Optional sections depend on server env: an API failure becomes null instead of failing the tool. */
async function optionalSection(ctx, path) {
  try {
    return withoutOk(await ctx.api.call("GET", path));
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/*
 * capabilities took about 4.5 s (#121). Profiled on the dev box: /api/health runs `ffmpeg -version`
 * on every call (about 1 s there) and its first call also probes libass (1 s); the first music read
 * probes the separator (2 s) and AMF (1 s), and then caches both itself. So the three reads run
 * together, and the health section, which is the same for every user and changes only with the
 * server's env or binaries, is kept for 60 s. Music (laptopOnline changes) and AI video (it depends
 * on who asks) are read on every call.
 */
const HEALTH_TTL_MS = 60_000;
let healthCache = null;
let now = Date.now;

/** Test seam: replace the clock (null restores Date.now); the health cache is emptied either way. */
export function _setCapabilitiesClockForTests(fn) {
  now = typeof fn === "function" ? fn : Date.now;
  healthCache = null;
}

/** The server and feature sections of /api/health, from a cache at most 60 s old. A failed read is not kept. */
async function serverHealth(ctx) {
  if (healthCache && now() - healthCache.at < HEALTH_TTL_MS) return healthCache.value;
  const health = await ctx.api.call("GET", "/api/health");
  const value = { server: health.system, features: health.capabilities };
  healthCache = { at: now(), value };
  return value;
}

const whoami = {
  name: "whoami",
  title: "Who am I",
  description:
    "Who you are acting as: the user, their plan, today's remaining quota, this key's daily caps (caps) and your account's daily caps shared by all your agents (accountCaps), and this key's name and publish permission. Call it first.",
  inputSchema: {},
  routes: ["/api/auth", "/api/billing"],
  async handler(ctx) {
    const me = await ctx.api.call("GET", "/api/auth/me");
    const body = await ctx.api.call("GET", "/api/billing/usage");
    const usage = body.usage;
    const user = me.user;
    return ok({
      user: {
        id: user.sub,
        email: user.email,
        role: user.role,
        isSuperAdmin: Boolean(user.isSuperAdmin),
        emailVerified: Boolean(user.emailVerified),
      },
      plan: usage.plan,
      quota: usage.buckets,
      caps: capsSummary(ctx.subjectId, ctx.agentKey),
      accountCaps: accountCapsSummary(ctx.agentKey?.userId ?? user.sub),
      key: ctx.agentKey
        ? { id: ctx.agentKey.id, name: ctx.agentKey.name, publishAllowed: Boolean(ctx.agentKey.publishAllowed) }
        : null,
    });
  },
};

const capabilities = {
  name: "capabilities",
  title: "Server capabilities",
  description:
    "What this BibleFuel server can do right now: ffmpeg and runtime, which providers are configured (booleans only), vocal removal availability, and AI video status. " +
    "These describe the server, not what this key may use: a free plan cannot use ElevenLabs even when elevenlabs is true, and AI video tools are listed only to super-admin keys. " +
    "whoami (plan, quotas, caps) and tools/list say what this key can do. Free; can take a few seconds.",
  inputSchema: {},
  routes: ["/api/health", "/api/music", "/api/video-gen"],
  async handler(ctx) {
    // Together, not one after another (#121): each can shell out on a cold start.
    const [health, music, aiVideo] = await Promise.all([
      serverHealth(ctx),
      optionalSection(ctx, "/api/music/capabilities"),
      optionalSection(ctx, "/api/video-gen/status"),
    ]);
    return ok({ ...health, music, aiVideo });
  },
};

export default [whoami, capabilities];
