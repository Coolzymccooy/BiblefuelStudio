import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { initErrorTracking, captureError, captureMessage, _resetErrorTracking } from "./errorTracking.js";

afterEach(() => _resetErrorTracking());

function fakeSentry() {
  const calls = [];
  return {
    calls,
    load: async () => ({
      init: (o) => calls.push(["init", o]),
      captureException: (e, o) => calls.push(["exception", e.message, o]),
      captureMessage: (m, o) => calls.push(["message", m, o]),
    }),
  };
}

test("without SENTRY_DSN nothing is loaded and reports are dropped", async () => {
  const s = fakeSentry();
  assert.equal(await initErrorTracking({}, { load: s.load }), false);
  captureError(new Error("x"));
  captureMessage("y");
  assert.deepEqual(s.calls, []);
});

test("with SENTRY_DSN errors and messages are sent, without personal data or tracing", async () => {
  const s = fakeSentry();
  assert.equal(await initErrorTracking({ SENTRY_DSN: "https://k@o1.ingest.sentry.io/1", NODE_ENV: "production" }, { load: s.load }), true);
  const [, opts] = s.calls[0];
  assert.equal(opts.environment, "production");
  assert.equal(opts.sendDefaultPii, false);
  assert.equal(opts.tracesSampleRate, 0);
  assert.deepEqual(opts.integrations, [], "no strict-mode integration on a client without one");
  captureError(new Error("render broke"), { tags: { kind: "render" } });
  captureMessage("disk-low: 1.2 GB free", { kind: "disk-low" });
  assert.deepEqual(s.calls.slice(1).map((c) => c.slice(0, 2)), [["exception", "render broke"], ["message", "disk-low: 1.2 GB free"]]);
});

test("a Sentry that fails to load or to send never throws", async () => {
  assert.equal(await initErrorTracking({ SENTRY_DSN: "x" }, { load: async () => { throw new Error("missing"); } }), false);
  await initErrorTracking({ SENTRY_DSN: "x" }, {
    load: async () => ({ init() {}, captureException() { throw new Error("down"); }, captureMessage() { throw new Error("down"); } }),
  });
  assert.doesNotThrow(() => captureError(new Error("a")));
  assert.doesNotThrow(() => captureMessage("b"));
});
