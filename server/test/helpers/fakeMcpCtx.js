/**
 * A fake MCP tool context for unit tests: `ctx.api.call` records every call and
 * answers from `responses`, keyed "METHOD /api/path" (query string excluded).
 * A response may be a body, a function (method, path, opts) => body, or an Error to throw.
 *
 * @param {Record<string, unknown>} [responses]
 * @param {{ user?: object, publicBase?: string, chargeCap?: Function }} [options]
 */
export function fakeMcpCtx(responses = {}, options = {}) {
  const calls = [];
  const charges = [];
  const api = {
    async call(method, path, opts = {}) {
      calls.push({ method, path, opts });
      const key = `${method} ${path}`;
      if (!Object.hasOwn(responses, key)) throw new Error(`fakeMcpCtx: no canned response for ${key}`);
      const answer = responses[key];
      if (answer instanceof Error) throw answer;
      return typeof answer === "function" ? answer(method, path, opts) : answer;
    },
  };
  const ctx = {
    user: options.user || { sub: "u_unit", email: "unit@example.com", role: "user" },
    publicBase: options.publicBase ?? "http://host.test",
    api,
    chargeCap: options.chargeCap || (async (bucket, amount) => { charges.push({ bucket, amount }); return null; }),
  };
  return { ctx, calls, charges };
}
