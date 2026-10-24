import { test } from "node:test";
import assert from "node:assert/strict";
import { cronProblem, changedCronProblem, agentScheduleCount, MAX_AGENT_SCHEDULES } from "./scheduleRules.js";

test("cronProblem accepts five fields with a single-number minute (at most hourly)", () => {
  for (const cron of ["0 9 * * *", "30 8 * * 1", "0 * * * *", " 15 6 1 * * "]) assert.equal(cronProblem(cron), null, cron);
});

test("cronProblem refuses anything that runs more often than hourly, or is not five fields", () => {
  for (const cron of ["* * * * *", "*/5 * * * *", "0,30 * * * *", "0-10 * * * *", "0 0 9 * * *", "0 9 * *", "", undefined]) {
    assert.match(String(cronProblem(cron)), /once an hour|five fields/, String(cron));
  }
});

test("changedCronProblem checks only schedules that are new or whose cron changed", () => {
  const stored = [{ id: "old", name: "Legacy", cron: "*/5 * * * *" }];
  assert.equal(changedCronProblem([{ id: "old", name: "Legacy", cron: "*/5 * * * *", enabled: false }], stored), null);
  assert.match(changedCronProblem([{ id: "old", name: "Legacy", cron: "*/10 * * * *" }], stored), /Legacy/);
  assert.match(changedCronProblem([{ id: "new", name: "Fresh", cron: "* * * * *" }], stored), /Fresh.*once an hour/);
  assert.equal(changedCronProblem([{ id: "new", cron: "0 6 * * *" }], stored), null);
});

test("agentScheduleCount counts schedules agents made, leaving out the one being replaced", () => {
  const list = [{ id: "a", createdByAgentKeyId: "k1" }, { id: "b" }, { id: "c", createdByAgentKeyId: "k2" }];
  assert.equal(agentScheduleCount(list), 2);
  assert.equal(agentScheduleCount(list, "a"), 1);
  assert.equal(agentScheduleCount(undefined), 0);
  assert.equal(MAX_AGENT_SCHEDULES, 5);
});
