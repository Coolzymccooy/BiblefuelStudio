import { describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import socialRouter from "./social.js";

// Schedule rules enforced by the routes themselves, for the app and for agents:
// R39 at most hourly, R35 at most 5 agent-made schedules (atomic with the write).

function app(seed) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "social-rules-"));
  if (seed) fs.writeFileSync(path.join(dataDir, "social.json"), JSON.stringify(seed));
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.ctx = { userId: "test-user", dataDir, outputDir: dataDir };
    next();
  });
  a.use("/api/social", socialRouter);
  return { a, dataDir };
}

const stored = (dataDir) => JSON.parse(fs.readFileSync(path.join(dataDir, "social.json"), "utf8")).schedules || [];
const auto = (extra = {}) => ({ name: "Auto", type: "auto_generate", cron: "0 6 * * *", timezone: "UTC", destination: "webhook", ...extra });
const LEGACY = { id: "sch_legacy", name: "Legacy", enabled: true, type: "auto_generate", cron: "*/5 * * * *", timezone: "UTC", destination: "webhook" };

describe("R39: schedules run at most once an hour", () => {
  for (const cron of ["*/5 * * * *", "* * * * *", "0,30 * * * *", "0 0 9 * * *"]) {
    test(`POST /schedules refuses "${cron}" with a clear 400 and saves nothing`, async () => {
      const { a, dataDir } = app();
      const res = await request(a).post("/api/social/schedules").send({ schedule: auto({ cron }) });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /once an hour|five fields/);
      assert.equal(fs.existsSync(path.join(dataDir, "social.json")) ? stored(dataDir).length : 0, 0);
    });
  }

  test("POST /schedules accepts an hourly or daily cron", async () => {
    const { a } = app();
    await request(a).post("/api/social/schedules").send({ schedule: auto({ cron: "0 * * * *" }) }).expect(200);
    await request(a).post("/api/social/schedules").send({ schedule: auto({ cron: "15 6 * * 1" }) }).expect(200);
  });

  test("a schedule saved before the rule can still be paused with its old cron, but not given a new sub-hourly one", async () => {
    const { a, dataDir } = app({ schedules: [LEGACY] });
    await request(a).post("/api/social/schedules").send({ schedule: { ...LEGACY, enabled: false } }).expect(200);
    assert.equal(stored(dataDir)[0].enabled, false);
    const res = await request(a).post("/api/social/schedules").send({ schedule: { ...LEGACY, cron: "*/2 * * * *" } });
    assert.equal(res.status, 400);
  });

  test("Save all (POST /config) refuses a new sub-hourly schedule and keeps an unchanged legacy one", async () => {
    const { a, dataDir } = app({ schedules: [LEGACY] });
    const bad = await request(a).post("/api/social/config").send({ schedules: [LEGACY, { id: "sch_new", name: "Every minute", cron: "* * * * *" }] });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /Every minute.*once an hour/);
    assert.deepEqual(stored(dataDir).map((s) => s.id), ["sch_legacy"]);
    await request(a).post("/api/social/config").send({ schedules: [{ ...LEGACY, enabled: false }] }).expect(200);
  });
});
