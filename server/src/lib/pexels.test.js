/**
 * pexelsDownloadVideoById names its output file after the id (pexels-<id>.mp4),
 * so a request id like "../x" could write outside the outputs folder. Only a
 * numeric Pexels id is accepted, checked before any request is made.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { pexelsDownloadVideoById } from "./pexels.js";
import pexelsRouter from "../routes/pexels.js";

const BAD_IDS = ["../x", "..\\..\\x", "123/../../evil", "12a", "", " 1", "1.5", "-1", "1e3"];
let savedKey;
before(() => { savedKey = process.env.PEXELS_API_KEY; process.env.PEXELS_API_KEY = "test-key-not-real"; });
after(() => { if (savedKey === undefined) delete process.env.PEXELS_API_KEY; else process.env.PEXELS_API_KEY = savedKey; });

describe("pexelsDownloadVideoById", () => {
  test("a non-numeric id is refused before any request", async () => {
    for (const id of BAD_IDS) {
      await assert.rejects(pexelsDownloadVideoById(id), /Pexels video id must be a number/, JSON.stringify(id));
    }
  });
});

describe("POST /api/pexels/download", () => {
  test("a traversal id is a 400 with the id message", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir: process.cwd(), outputDir: process.cwd() }; next(); });
    app.use("/api/pexels", pexelsRouter);
    const res = await request(app).post("/api/pexels/download").send({ id: "../x" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Pexels video id must be a number/);
  });
});
