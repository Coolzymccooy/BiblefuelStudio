import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { charge } from "../lib/agentKeys/caps.js";
import { logActivity } from "../lib/agentKeys/activity.js";
import { ApiError } from "./api.js";
import { fail } from "./toolResult.js";

/**
 * Builds one McpServer per MCP request from the tool catalogue. Every tool
 * handler runs inside a wrapper that applies, in order: publish consent, the
 * daily caps, the handler itself (API errors become tool errors), then the
 * activity log and the [MCP] info line.
 *
 * @typedef {{ user: object, agentKey: object | null, subjectId: string, isSuperAdmin: boolean,
 *   baseUrl: string, publicBase: string, api: { call: Function } }} McpCtx
 * @typedef {{ name: string, title: string, description: string, inputSchema: object,
 *   requires?: "super_admin", publish?: boolean,
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
  return modules.flatMap((mod, i) => {
    if (!Array.isArray(mod.default)) throw new Error(`mcp: tools/${files[i]} must export an array of tools`);
    return mod.default;
  });
}

const importedCatalogue = await loadCatalogue();
let catalogueOverride = null;

/** Test seam: replace the catalogue with `defs`; pass null to restore the imported one. */
export function _setCatalogueForTests(defs) {
  catalogueOverride = Array.isArray(defs) ? defs : null;
}

function catalogue() {
  return catalogueOverride || importedCatalogue;
}

function allowed(def, ctx) {
  if (def.requires === undefined) return true;
  return def.requires === "super_admin" && ctx.isSuperAdmin;
}

async function chargeCaps(def, ctx, input, charged) {
  for (const [bucket, amountOrFn] of Object.entries(def.caps || {})) {
    const amount = typeof amountOrFn === "function" ? amountOrFn(input) : amountOrFn;
    if (amount === 0) continue;
    const outcome = await charge(ctx.subjectId, ctx.agentKey, bucket, amount);
    if (!outcome.ok) {
      const { used, limit, resetsAt } = outcome;
      return fail("MCP_CAP_REACHED", `Daily ${bucket} cap reached for this agent (${used} of ${limit}).`, {
        bucket,
        used,
        limit,
        resetsAt,
      });
    }
    charged[bucket] = amount;
  }
  return null;
}

async function runTool(def, ctx, input, charged) {
  if (def.publish && ctx.agentKey && !ctx.agentKey.publishAllowed) {
    return fail("PUBLISH_NOT_ALLOWED", "This agent key may not publish. Allow publishing for it in Settings.");
  }
  try {
    const refused = await chargeCaps(def, ctx, input, charged);
    if (refused) return refused;
    return await def.handler(ctx, input);
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, { hint: err.hint, status: err.status });
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
  const keyLabel = (ctx.agentKey?.id || "jwt").slice(0, 8);
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
  return server;
}
