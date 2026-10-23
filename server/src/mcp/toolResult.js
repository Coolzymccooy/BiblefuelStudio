/**
 * The two shapes every MCP tool returns. `structuredContent` carries the data
 * for agents that read it; the text block carries the same for those that do not.
 */

/** @param {object} data */
export function ok(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/**
 * @param {string} code e.g. "QUOTA_EXCEEDED"
 * @param {string} message
 * @param {object} [extra] merged into structuredContent
 */
export function fail(code, message, extra = {}) {
  return {
    isError: true,
    content: [{ type: "text", text: `${code}: ${message}` }],
    structuredContent: { error: code, message, ...extra },
  };
}

/** A response body as a copy without its `ok` flag; null or undefined gives {}. */
export function withoutOk(body) {
  const { ok: _ok, ...rest } = body || {};
  return rest;
}
