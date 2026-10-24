/**
 * pixabayDownloadVideoById names its output file after the id
 * (pixabay-<id>.mp4) and puts it in the API query, so a request id like
 * "123/../.." could write outside the outputs folder (#112). Only a numeric
 * Pixabay id is accepted, checked before any request is made.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { pixabayDownloadVideoById } from "./pixabay.js";
import pixabayRouter from "../routes/pixabay.js";

const BAD_IDS = ["123/../..", "../x", "..\\..\\x", "12a", "", " 1", "1.5", "-1", "1e3"];
let savedKey;
before(() => { savedKey = process.env.PIXABAY_API_KEY; process.env.PIXABAY_API_KEY = "test-key-not-real"; });
after(() => { if (savedKey === undefined) delete process.env.PIXABAY_API_KEY; else process.env.PIXABAY_API_KEY = savedKey; });

describe("pixabayDownloadVideoById", () => {
  // The refusal comes before the request: the error names the id, not the
  // (fake) key the Pixabay API would reject.
  test("a non-numeric id is refused before any request", async () => {
    for (const id of BAD_IDS) {
      await assert.rejects(pixabayDownloadVideoById(id), /Pixabay video id must be a number/, JSON.stringify(id));
    }
  });
});

describe("POST /api/pixabay/download", () => {
  test("a traversal id is a 400 with the id message", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir: process.cwd(), outputDir: process.cwd() }; next(); });
    app.use("/api/pixabay", pixabayRouter);
    const res = await request(app).post("/api/pixabay/download").send({ id: "123/../.." });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Pixabay video id must be a number/);
  });
});
