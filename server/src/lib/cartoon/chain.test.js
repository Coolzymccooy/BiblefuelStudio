import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { limiter, runInOrder } from "./chain.js";

const tick = (ms = 2) => new Promise((r) => setTimeout(r, ms));

describe("cartoon chain scheduler", () => {
  test("the limiter never runs more than its maximum at once", async () => {
    const limit = limiter(2);
    let active = 0;
    let most = 0;
    const task = async () => { active += 1; most = Math.max(most, active); await tick(); active -= 1; };
    await Promise.all([1, 2, 3, 4, 5].map(() => limit(task)));
    assert.equal(most, 2);
  });

  test("a chained shot starts only after its parent in the run has finished", async () => {
    const log = [];
    const parents = { b: "a", d: "c" };
    await runInOrder(["a", "b", "c", "d"], {
      parentOf: (id) => parents[id] || null,
      concurrency: 4,
      run: async (id) => { log.push(`start ${id}`); await tick(); log.push(`end ${id}`); },
    });
    assert.deepEqual(log.slice(0, 2), ["start a", "start c"]);
    assert.ok(log.indexOf("start b") > log.indexOf("end a"));
    assert.ok(log.indexOf("start d") > log.indexOf("end c"));
  });

  test("a parent outside the run is not waited for, and a failed parent still releases its child", async () => {
    const started = [];
    const settled = await runInOrder(["b", "c"], {
      parentOf: (id) => ({ b: "a", c: "b" }[id]),
      concurrency: 1,
      run: async (id) => { started.push(id); if (id === "b") throw new Error("boom"); },
    });
    assert.deepEqual(started, ["b", "c"]);
    assert.equal(settled[0].status, "rejected");
    assert.equal(settled[1].status, "fulfilled");
  });
});
