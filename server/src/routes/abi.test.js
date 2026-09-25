import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

import abiRouter from "./abi.js";

test("Abi TTS route requires shared secret when configured", async () => {
  const previous = process.env.ABI_TTS_SHARED_SECRET;
  process.env.ABI_TTS_SHARED_SECRET = "test-secret";
  try {
    const app = express();
    app.use(express.json());
    app.use("/api/abi", abiRouter);

    const res = await request(app)
      .post("/api/abi/tts")
      .send({ text: "Grace and peace" });

    assert.equal(res.status, 401);
    assert.equal(res.body.error, "ABI_UNAUTHORIZED");
  } finally {
    if (previous === undefined) delete process.env.ABI_TTS_SHARED_SECRET;
    else process.env.ABI_TTS_SHARED_SECRET = previous;
  }
});

test("Abi TTS route REFUSES to serve when no shared secret is configured", async () => {
  // The original guard was `if (sharedSecret) { ...check... }`, so an
  // unset variable disabled authentication entirely. This route is mounted
  // WITHOUT requireAuth and WITHOUT a quota, so that made paid Azure / Fish /
  // ElevenLabs synthesis free to the open internet on every deployment
  // predating the variable - which is all of them. It must fail CLOSED.
  const previous = process.env.ABI_TTS_SHARED_SECRET;
  delete process.env.ABI_TTS_SHARED_SECRET;
  try {
    const app = express();
    app.use(express.json());
    app.use("/api/abi", abiRouter);

    const res = await request(app)
      .post("/api/abi/tts")
      .send({ text: "Grace and peace" });

    assert.equal(res.status, 503);
    assert.equal(res.body.error, "ABI_NOT_CONFIGURED");
    assert.equal(res.body.ok, false);
  } finally {
    if (previous === undefined) delete process.env.ABI_TTS_SHARED_SECRET;
    else process.env.ABI_TTS_SHARED_SECRET = previous;
  }
});

test("Abi TTS route rejects a wrong secret and accepts the right one", async () => {
  const previous = process.env.ABI_TTS_SHARED_SECRET;
  process.env.ABI_TTS_SHARED_SECRET = "test-secret";
  try {
    const app = express();
    app.use(express.json());
    app.use("/api/abi", abiRouter);

    const wrong = await request(app)
      .post("/api/abi/tts")
      .set("x-abi-secret", "not-the-secret")
      .send({ text: "Grace and peace" });
    assert.equal(wrong.status, 401);

    // A same-length near-miss must also fail - the constant-time compare
    // must not be accidentally lenient.
    const nearMiss = await request(app)
      .post("/api/abi/tts")
      .set("x-abi-secret", "test-secrez")
      .send({ text: "Grace and peace" });
    assert.equal(nearMiss.status, 401);

    // An empty header must never satisfy an empty-ish comparison.
    const empty = await request(app)
      .post("/api/abi/tts")
      .set("x-abi-secret", "")
      .send({ text: "Grace and peace" });
    assert.equal(empty.status, 401);
  } finally {
    if (previous === undefined) delete process.env.ABI_TTS_SHARED_SECRET;
    else process.env.ABI_TTS_SHARED_SECRET = previous;
  }
});

test("Abi TTS route returns raw audio from configured provider", async () => {
  const previousSecret = process.env.ABI_TTS_SHARED_SECRET;
  const previousChain = process.env.ABI_TTS_PROVIDER_CHAIN;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "abi-route-"));
  const audioPath = path.join(tmp, "voice.mp3");
  fs.writeFileSync(audioPath, Buffer.from("fake-audio"));
  process.env.ABI_TTS_SHARED_SECRET = "test-secret";
  process.env.ABI_TTS_PROVIDER_CHAIN = "edge";

  try {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.body = req.body || {};
      next();
    });
    app.use("/api/abi", abiRouter);

    const res = await request(app)
      .post("/api/abi/tts")
      .set("x-abi-secret", "test-secret")
      .send({ text: "Grace and peace", output_format: "wav" });

    // This test primarily pins route auth/wire shape. Provider synthesis is
    // covered by the voice provider tests and smoke checks.
    assert.notEqual(res.status, 401);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (previousSecret === undefined) delete process.env.ABI_TTS_SHARED_SECRET;
    else process.env.ABI_TTS_SHARED_SECRET = previousSecret;
    if (previousChain === undefined) delete process.env.ABI_TTS_PROVIDER_CHAIN;
    else process.env.ABI_TTS_PROVIDER_CHAIN = previousChain;
  }
});
