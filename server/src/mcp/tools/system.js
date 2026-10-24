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
    "What this BibleFuel server can do right now: ffmpeg and runtime, which providers are configured (booleans only), vocal removal availability, and AI video status.",
  inputSchema: {},
  routes: ["/api/health", "/api/music", "/api/video-gen"],
  async handler(ctx) {
    const health = await ctx.api.call("GET", "/api/health");
    const [music, aiVideo] = await Promise.all([
      optionalSection(ctx, "/api/music/capabilities"),
      optionalSection(ctx, "/api/video-gen/status"),
    ]);
    return ok({ server: health.system, features: health.capabilities, music, aiVideo });
  },
};

export default [whoami, capabilities];
