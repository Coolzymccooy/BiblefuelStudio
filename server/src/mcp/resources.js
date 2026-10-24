import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { JOB_KINDS, NORMALISERS, outputUrl } from "./jobs.js";

/**
 * The job handle as an MCP resource, for clients that prefer reading resources
 * to calling jobs_get / jobs_wait. A read is one look at the kind's status
 * route through the caller's own loopback API (ctx.api) and the kind's
 * normaliser, the same path jobs_wait takes, so ownership, plan checks and
 * errors are exactly the tools'. Reads are free: no caps, nothing started.
 *
 * Kinds whose status route is nested under a project (lyric_render) take the
 * project in the query: biblefuel://jobs/lyric_render/<jobId>?projectId=<songId>.
 */

export const JOB_TEMPLATE_URI = "biblefuel://jobs/{kind}/{id}";
const MIME = "application/json";

/** An MCP error whose text reads `CODE: message`, like a tool error, with the same object as data. */
function refusal(code, message, extra = {}) {
  return new McpError(ErrorCode.InvalidParams, `${code}: ${message}`, { error: code, message, ...extra });
}

function decoded(value) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    throw refusal("BAD_INPUT", "The job address is not valid. Use biblefuel://jobs/<kind>/<id>.");
  }
}

/**
 * The kind, id and projectId a job URI names. The SDK's template match leaves values encoded and lets
 * the id run on into a query string, so the id is cut at `?` or `#` and decoded here.
 */
export function jobAddress(uri, variables) {
  const rawId = String(variables?.id ?? "").split(/[?#]/)[0];
  const projectId = uri.searchParams.get("projectId") || undefined;
  return { kind: decoded(variables?.kind), id: decoded(rawId), projectId };
}

/** jobs_get adds what a queue job is and when it was made; the resource gives the same object. */
function withJobRow(kind, handle, payload) {
  if (kind !== "job") return handle;
  return { ...handle, type: payload?.job?.type ?? null, createdAt: payload?.job?.createdAt ?? null };
}

/** Refuses what jobs_wait refuses, with the same codes and words. */
function addressRefusal({ kind, id, projectId }) {
  if (!Object.hasOwn(NORMALISERS, kind)) {
    return refusal("BAD_KIND", `Unknown job kind "${kind}". Use one of: ${JOB_KINDS.join(", ")}.`);
  }
  if (!id) return refusal("BAD_INPUT", "The job address needs an id: biblefuel://jobs/<kind>/<id>.");
  if (NORMALISERS[kind].needsProjectId && !projectId) {
    return refusal("BAD_INPUT", `A ${kind} job needs projectId as well as id: pass both from the handle that started it.`);
  }
  return null;
}

/**
 * One read of a job's handle. Throws an McpError: the app's own answer (code, message, hint, status) when
 * it refuses, which for someone else's job is the same 404 a missing job gets; INTERNAL for anything else.
 */
export async function readJobHandle(ctx, address) {
  const refused = addressRefusal(address);
  if (refused) throw refused;
  const { kind, id, projectId } = address;
  const entry = NORMALISERS[kind];
  let payload;
  try {
    payload = await ctx.api.call("GET", entry.route(id, projectId));
  } catch (err) {
    if (err?.name === "ApiError") throw refusal(err.code, err.message, { hint: err.hint ?? null, status: err.status });
    console.warn("[MCP] job resource read failed:", err?.message || String(err));
    throw new McpError(ErrorCode.InternalError, "INTERNAL: Something went wrong", { error: "INTERNAL", message: "Something went wrong" });
  }
  const handle = entry.normalise(payload, { outputUrl: (p) => outputUrl(p, ctx.publicBase) });
  return withJobRow(kind, { ...handle, id, ...(projectId ? { projectId } : {}) }, payload);
}

/** Registers biblefuel://jobs/{kind}/{id} on one McpServer built for `ctx`. */
export function registerJobResource(server, ctx) {
  server.registerResource(
    "job",
    new ResourceTemplate(JOB_TEMPLATE_URI, { list: async () => ({ resources: [] }) }),
    {
      title: "A job handle",
      description:
        `The handle of one background job, as jobs_wait returns it but without waiting. kind is one of ${JOB_KINDS.join(", ")}; ` +
        "id is the handle's id (the project id for story, ambient, scene, longform, lyric_align and moments). " +
        "For lyric_render add ?projectId=<the song's id>. Free.",
      mimeType: MIME,
    },
    async (uri, variables) => {
      const handle = await readJobHandle(ctx, jobAddress(uri, variables));
      return { contents: [{ uri: uri.href, mimeType: MIME, text: JSON.stringify(handle, null, 2) }] };
    },
  );
}
