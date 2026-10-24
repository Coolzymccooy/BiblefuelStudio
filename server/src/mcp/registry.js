import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { chargeAll, refundAll } from "../lib/agentKeys/caps.js";
import { logActivity } from "../lib/agentKeys/activity.js";
import { ApiError } from "./api.js";
import { fail, PUBLISH_NOT_ALLOWED_MESSAGE } from "./toolResult.js";
import { lacksPublishConsent } from "./autoPublish.js";
import { planAllows } from "../middleware/featureGate.js";
import { registerJobResource } from "./resources.js";

export { PUBLISH_NOT_ALLOWED_MESSAGE };

/**
 * Builds one McpServer per MCP request from the tool catalogue. Every tool
 * handler runs inside a wrapper that applies, in order: publish consent, the
 * daily caps, the handler itself (API errors become tool errors), then the
 * activity log and the [MCP] info line.
 *
 * A handler also gets `ctx.chargeCap(bucket, amount)` or `ctx.chargeCap({ bucket: amount, ... })`: it spends
 * from the key's (and its account's) daily cap buckets mid-handler (for tools whose cost depends on what they
 * find) and returns null on success, or the MCP_CAP_REACHED tool error to hand straight back. Several buckets
 * are charged atomically: when one is refused, none is spent. A def's declared `caps` are charged the same way.
 *
 * Refunds (R37): when the app answers a call with a 4xx (it refused, so no work started), everything the
 * call charged is given back on the key and the account, except `imports` (R32: an attempt always counts).
 * A 5xx or a network failure keeps the charge. A handler whose call turned out to cost nothing (a YouTube
 * upload that joined one already running) calls `ctx.refundCap(...)`, which gives back at most what this
 * call charged.
 *
 * @typedef {{ user: object, agentKey: object, subjectId: string, isSuperAdmin: boolean, plan?: string,
 *   baseUrl: string, publicBase: string, api: { call: Function },
 *   chargeCap?: (bucketOrAmounts: string | Record<string, number>, amount?: number) => Promise<object | null>,
 *   refundCap?: (bucketOrAmounts: string | Record<string, number>, amount?: number) => Promise<void> }} McpCtx
 * @typedef {{ name: string, title: string, description: string, inputSchema: object,
 *   requires?: "super_admin" | `feature:${string}`, publish?: boolean,
 *   caps?: Record<string, number | ((input: object) => number)>,
 *   handler: (ctx: McpCtx, input: object) => Promise<object> }} ToolDef
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "../..");
const TOOLS_DIR = path.join(__dirname, "tools");
const GUIDE_FILE = path.resolve(SERVER_ROOT, "../docs/mcp.md");
const GUIDE_URI = "biblefuel://guide";
const SERVER_INFO = { name: "biblefuel", version: "1.0.0" };
const MAX_LOGGED_ERROR = 300;

/** Reads every tools/*.js default export (an array of ToolDef). A missing folder is an empty catalogue. */
async function loadCatalogue() {
  let files;
  try {
    files = fs.readdirSync(TOOLS_DIR).filter((name) => name.endsWith(".js") && !name.endsWith(".test.js"));
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const modules = await Promise.all(
    files.sort().map((name) => import(pathToFileURL(path.join(TOOLS_DIR, name)).href)),
  );
  const defs = modules.flatMap((mod, i) => {
    if (!Array.isArray(mod.default)) throw new Error(`mcp: tools/${files[i]} must export an array of tools`);
    return mod.default;
  });
  assertUniqueNames(defs);
  return defs;
}

function assertUniqueNames(defs) {
  const seen = new Set();
  for (const def of defs) {
    if (seen.has(def.name)) throw new Error(`mcp: duplicate tool name ${def.name}`);
    seen.add(def.name);
  }
}

const importedCatalogue = await loadCatalogue();
let catalogueOverride = null;

/** Test seam: replace the catalogue with `defs`; pass null to restore the imported one. */
export function _setCatalogueForTests(defs) {
  catalogueOverride = Array.isArray(defs) ? defs : null;
}

/** Every tool def the server can list (before per-user filtering). */
export function catalogue() {
  return catalogueOverride || importedCatalogue;
}

const FEATURE_REQUIREMENT = /^feature:(.+)$/;

/**
 * Whether the key's user may see the tool: `requires: "super_admin"` for super-admin routes,
 * `requires: "feature:<capability>"` for routes behind featureGate(<capability>) (the same plan check).
 * Any other value hides the tool.
 */
function allowed(def, ctx) {
  if (def.requires === undefined) return true;
  if (def.requires === "super_admin") return Boolean(ctx.isSuperAdmin);
  const feature = FEATURE_REQUIREMENT.exec(String(def.requires));
  return Boolean(feature) && planAllows(ctx.plan, feature[1]);
}

/**
 * Spends every bucket in `amounts` at once (zero amounts skipped); returns null on success or the
 * MCP_CAP_REACHED tool error. A refusal spends nothing.
 */
async function chargeBuckets(ctx, amounts, charged) {
  const due = Object.entries(amounts).filter(([, amount]) => amount !== 0);
  if (due.length === 0) return null;
  const outcome = await chargeAll(ctx.subjectId, ctx.agentKey, Object.fromEntries(due));
  if (!outcome.ok) {
    const { bucket, scope, used, limit, resetsAt } = outcome;
    const whose = scope === "user" ? "your account across all agents" : "this agent";
    return fail("MCP_CAP_REACHED", `Daily ${bucket} cap reached for ${whose} (${used} of ${limit}).`, {
      bucket,
      scope,
      used,
      limit,
      resetsAt,
    });
  }
  for (const [bucket, amount] of due) charged[bucket] = (charged[bucket] || 0) + amount;
  return null;
}

function chargeCaps(def, ctx, input, charged) {
  const amounts = Object.entries(def.caps || {}).map(([bucket, amountOrFn]) => [
    bucket,
    typeof amountOrFn === "function" ? amountOrFn(input) : amountOrFn,
  ]);
  return chargeBuckets(ctx, Object.fromEntries(amounts), charged);
}

const asAmounts = (bucketOrAmounts, amount) =>
  (typeof bucketOrAmounts === "string" ? { [bucketOrAmounts]: amount ?? 1 } : bucketOrAmounts) || {};

/** `ctx.chargeCap(bucket, amount)` or `ctx.chargeCap({ bucket: amount, ... })`. */
function chargeCapFor(ctx, charged) {
  return (bucketOrAmounts, amount) => chargeBuckets(ctx, asAmounts(bucketOrAmounts, amount), charged);
}

// R32: an import attempt always counts, so the imports bucket is never given back.
const NEVER_REFUNDED = new Set(["imports"]);

/**
 * Gives back up to `amounts` of what this call has charged (never more, never imports), on the key
 * and the account, and lowers `charged` to match.
 */
async function refundBuckets(ctx, amounts, charged) {
  const due = Object.entries(amounts)
    .filter(([bucket, amount]) => !NEVER_REFUNDED.has(bucket) && amount > 0 && charged[bucket] > 0)
    .map(([bucket, amount]) => [bucket, Math.min(amount, charged[bucket])]);
  if (due.length === 0) return;
  await refundAll(ctx.subjectId, ctx.agentKey, Object.fromEntries(due));
  for (const [bucket, amount] of due) {
    const left = charged[bucket] - amount;
    if (left > 0) charged[bucket] = left;
    else delete charged[bucket];
  }
}

/** `ctx.refundCap(bucket, amount)` or `ctx.refundCap({ bucket: amount, ... })`: for a call that did no billable work. */
function refundCapFor(ctx, charged) {
  return (bucketOrAmounts, amount) => refundBuckets(ctx, asAmounts(bucketOrAmounts, amount), charged);
}

/** R37: the app refused the call (4xx), so nothing it charged was spent. A 5xx may have started work. */
const isRefusal = (err) => err.status >= 400 && err.status < 500;

/** Refunds everything this call charged; a failed refund is logged, never thrown over the tool's own error. */
async function refundRefused(def, ctx, charged) {
  try {
    await refundBuckets(ctx, { ...charged }, charged);
  } catch (err) {
    console.warn(`[MCP] tool ${def.name} cap refund failed:`, err?.message || String(err));
  }
}

async function runTool(def, ctx, input, charged) {
  if (def.publish && lacksPublishConsent(ctx)) {
    return fail("PUBLISH_NOT_ALLOWED", PUBLISH_NOT_ALLOWED_MESSAGE);
  }
  try {
    const refused = await chargeCaps(def, ctx, input, charged);
    if (refused) return refused;
    const callCtx = { ...ctx, chargeCap: chargeCapFor(ctx, charged), refundCap: refundCapFor(ctx, charged) };
    return await def.handler(callCtx, input);
  } catch (err) {
    if (err instanceof ApiError) {
      if (isRefusal(err)) await refundRefused(def, ctx, charged);
      return fail(err.code, err.message, { hint: err.hint, status: err.status });
    }
    console.warn(`[MCP] tool ${def.name} failed:`, err?.message || String(err));
    return fail("INTERNAL", "Something went wrong");
  }
}

function jobOf(result) {
  const data = result?.structuredContent;
  if (!data || typeof data.kind !== "string" || data.id === undefined) return null;
  return { kind: data.kind, id: data.id };
}

function record(def, ctx, input, result, ms, charged) {
  const isError = Boolean(result?.isError);
  const keyLabel = String(ctx.agentKey?.id || "").slice(0, 8);
  console.info(`[MCP] key=${keyLabel} tool=${def.name} ms=${ms} ${isError ? "error" : "ok"}`);
  try {
    logActivity({
      keyId: ctx.agentKey?.id ?? null,
      keyName: ctx.agentKey?.name ?? null,
      userId: ctx.user?.sub ?? null,
      email: ctx.user?.email ?? null,
      tool: def.name,
      input,
      ok: !isError,
      error: isError ? String(result?.content?.[0]?.text || "").slice(0, MAX_LOGGED_ERROR) : null,
      ms,
      job: jobOf(result),
      caps: charged,
    });
  } catch (err) {
    console.warn("[MCP] activity log write failed:", err?.message || String(err));
  }
}

function wrap(def, ctx) {
  return async (input) => {
    const started = Date.now();
    const charged = {};
    const result = await runTool(def, ctx, input, charged);
    record(def, ctx, input, result, Date.now() - started, charged);
    return result;
  };
}

function readGuide() {
  try {
    return fs.readFileSync(GUIDE_FILE, "utf-8");
  } catch (err) {
    console.warn("[MCP] guide not readable:", err?.message || String(err));
    return "# Connect an agent to BibleFuel\n\nThe guide is not available on this server.\n";
  }
}

/** @param {McpCtx} ctx */
export function buildServer(ctx) {
  const server = new McpServer(SERVER_INFO);
  for (const def of catalogue()) {
    if (!allowed(def, ctx)) continue;
    server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: def.inputSchema },
      wrap(def, ctx),
    );
  }
  server.registerResource(
    "guide",
    GUIDE_URI,
    { title: "Connect an agent to BibleFuel", description: "How to use the BibleFuel tools.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: readGuide() }] }),
  );
  registerJobResource(server, ctx);
  return server;
}
