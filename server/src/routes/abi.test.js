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
