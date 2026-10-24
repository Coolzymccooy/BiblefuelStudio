/**
 * A fake MCP tool context for unit tests: `ctx.api.call` records every call and
 * answers from `responses`, keyed "METHOD /api/path" (query string excluded).
 * A response may be a body, a function (method, path, opts) => body, or an Error to throw.
 *
 * @param {Record<string, unknown>} [responses]
 * `refundCap` records each refund in `refunds` the same way `chargeCap` records `charges`.
 *
 * @param {{ user?: object, publicBase?: string, chargeCap?: Function }} [options]
 */
export function fakeMcpCtx(responses = {}, options = {}) {
  const calls = [];
  const charges = [];
  const refunds = [];
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
    chargeCap: options.chargeCap || (async (bucketOrAmounts, amount) => {
      // Mirrors the registry: (bucket, amount) or one atomic object of { bucket: amount }.
      const amounts = typeof bucketOrAmounts === "string" ? { [bucketOrAmounts]: amount ?? 1 } : bucketOrAmounts;
      for (const [bucket, value] of Object.entries(amounts || {})) charges.push({ bucket, amount: value });
      return null;
    }),
    refundCap: async (bucketOrAmounts, amount) => {
      const amounts = typeof bucketOrAmounts === "string" ? { [bucketOrAmounts]: amount ?? 1 } : bucketOrAmounts;
      for (const [bucket, value] of Object.entries(amounts || {})) refunds.push({ bucket, amount: value });
    },
  };
  return { ctx, calls, charges, refunds };
}
