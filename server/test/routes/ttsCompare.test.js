/**
 * POST /api/tts/compare — synthesize the same text across 2–4 candidate
 * providers in parallel, return per-candidate results so the UI can play
 * them side-by-side and rate them.
 *
 * These tests cover the route shape (validation, parallel synth, partial
 * failures, premium gating). The actual synthesis is mocked via the
 * `_setCompareSynthImpl` seam exported from the router — same pattern the
 * Azure provider uses for its SDK seam. No real provider calls.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import supertest from "supertest";

const ttsModule = await import("../../src/routes/tts.js");
const ttsRouter = ttsModule.default;
const { _setCompareSynthImpl } = ttsModule;

function mkApp({ plan = "free", userId = "u-test" } = {}) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use((req, _res, next) => {
    req.ctx = { userId, email: `${userId}@x.y`, plan, isSuperAdmin: plan === "super_admin" };
    next();
  });
  app.use("/api/tts", ttsRouter);
  return app;
}

function post(app, body) {
  return supertest(app).post("/api/tts/compare").send(body);
}

// Default mock: returns a deterministic SpeechResult per candidate.
function makeMockSynth({ failProviders = new Set(), slowProviders = new Map() } = {}) {
  return async ({ text, preferredProvider, voiceIds }) => {
    if (failProviders.has(preferredProvider)) {
      throw new Error(`${preferredProvider} synthesis failed`);
    }
    const slowMs = slowProviders.get(preferredProvider);
    if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
    return {
      ok: true,
      file: `/outputs/compare/${preferredProvider}-fake.mp3`,
      provider: preferredProvider,
      voice: voiceIds?.[preferredProvider] || `${preferredProvider}-default`,
      words: [{ text: text.split(/\s+/)[0] || "x", startMs: 0, endMs: 100 }],
    };
  };
}

before(() => {
  _setCompareSynthImpl(makeMockSynth());
});

after(() => {
  _setCompareSynthImpl(null); // restore real synthesize
});

test("400 when text is missing or empty", async () => {
  const app = mkApp();
  const r1 = await post(app, { candidates: [{ provider: "edge" }] });
  assert.equal(r1.status, 400);
  const r2 = await post(app, { text: "   ", candidates: [{ provider: "edge" }] });
  assert.equal(r2.status, 400);
});

test("400 when candidates is missing, empty, or > 4", async () => {
  const app = mkApp();
  const r1 = await post(app, { text: "hello world" });
  assert.equal(r1.status, 400);
  const r2 = await post(app, { text: "hello", candidates: [] });
  assert.equal(r2.status, 400);
  const r3 = await post(app, {
    text: "hello",
    candidates: Array.from({ length: 5 }, () => ({ provider: "edge" })),
  });
  assert.equal(r3.status, 400);
});

test("400 when a candidate is missing provider", async () => {
  const app = mkApp();
  const r = await post(app, {
    text: "hello",
    candidates: [{ provider: "edge" }, { voiceId: "x" }],
  });
  assert.equal(r.status, 400);
});

test("200 with all-ok candidates returns one result per candidate, parallel", async () => {
  // Make each provider take 150ms — wall-clock for 3 parallel synths
  // should be well under 3*150ms = 450ms if they run in parallel.
  _setCompareSynthImpl(
    makeMockSynth({
      slowProviders: new Map([
        ["edge", 150],
        ["chatterbox", 150],
        ["azure", 150],
      ]),
    }),
  );

  const app = mkApp({ plan: "super_admin" });
  const t0 = Date.now();
  const r = await post(app, {
    text: "For God so loved the world.",
    candidates: [
      { provider: "edge", voiceId: "en-US-AriaNeural", label: "Aria" },
      { provider: "chatterbox", label: "Local" },
      { provider: "azure", voiceId: "en-US-GuyNeural" },
    ],
  });
  const wall = Date.now() - t0;

  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.results.length, 3);

  for (const cand of r.body.results) {
    assert.equal(cand.status, "ok");
    assert.ok(cand.id, "candidate has id");
    assert.ok(cand.provider, "candidate has provider");
    assert.ok(cand.file, "candidate has file path");
    assert.equal(typeof cand.latencyMs, "number");
  }

  assert.ok(wall < 400, `expected parallel synth (wall ${wall}ms < 400ms)`);

  // restore default
  _setCompareSynthImpl(makeMockSynth());
});

test("one candidate failing does NOT fail the whole request", async () => {
  _setCompareSynthImpl(
    makeMockSynth({ failProviders: new Set(["chatterbox"]) }),
  );

  const app = mkApp({ plan: "super_admin" });
  const r = await post(app, {
    text: "hello world",
    candidates: [
      { provider: "edge" },
      { provider: "chatterbox" },
      { provider: "azure" },
    ],
  });

  assert.equal(r.status, 200);
  assert.equal(r.body.results.length, 3);
  const byProvider = Object.fromEntries(r.body.results.map((c) => [c.provider, c]));
  assert.equal(byProvider.edge.status, "ok");
  assert.equal(byProvider.azure.status, "ok");
  assert.equal(byProvider.chatterbox.status, "error");
  assert.match(byProvider.chatterbox.error, /chatterbox synthesis failed/);

  _setCompareSynthImpl(makeMockSynth());
});

test("free plan: premium-gated candidates (fish, elevenlabs) return forbidden, others proceed", async () => {
  const app = mkApp({ plan: "free" });
  const r = await post(app, {
    text: "hello",
    candidates: [
      { provider: "fish" },
      { provider: "elevenlabs" },
      { provider: "edge" },
      { provider: "chatterbox" },
    ],
  });

  assert.equal(r.status, 200);
  const byProvider = Object.fromEntries(r.body.results.map((c) => [c.provider, c]));
  assert.equal(byProvider.fish.status, "error");
  assert.match(byProvider.fish.error, /premium|forbidden/i);
  assert.equal(byProvider.elevenlabs.status, "error");
  assert.match(byProvider.elevenlabs.error, /premium|forbidden/i);
  assert.equal(byProvider.edge.status, "ok");
  assert.equal(byProvider.chatterbox.status, "ok");
});

test("premium plan: all candidates proceed (no gating block)", async () => {
  const app = mkApp({ plan: "premium" });
  const r = await post(app, {
    text: "hello",
    candidates: [
      { provider: "fish" },
      { provider: "elevenlabs" },
      { provider: "edge" },
    ],
  });

  assert.equal(r.status, 200);
  for (const cand of r.body.results) {
    assert.equal(cand.status, "ok", `${cand.provider} should be ok on premium`);
  }
});
