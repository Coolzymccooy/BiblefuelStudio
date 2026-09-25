import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { runExclusive, isHeavyBusy, _resetHeavyGate } from "./heavyJobGate.js";

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

describe("heavyJobGate", () => {
  beforeEach(() => _resetHeavyGate());

  test("a second job waits for the first", async () => {
    const first = deferred();
    const order = [];
    const a = runExclusive(async () => { order.push("a start"); await first.promise; order.push("a end"); });
    let queued = false;
    const b = runExclusive(async () => { order.push("b start"); }, { onQueued: () => { queued = true; } });
    await new Promise((r) => setImmediate(r));
    assert.equal(queued, true);
    assert.deepEqual(order, ["a start"]);
    first.resolve();
    await Promise.all([a, b]);
    assert.deepEqual(order, ["a start", "a end", "b start"]);
    assert.equal(isHeavyBusy(), false);
  });

  test("a failed job releases the gate", async () => {
    await assert.rejects(runExclusive(async () => { throw new Error("boom"); }), /boom/);
    assert.equal(await runExclusive(async () => 7), 7);
  });

  test("a queued job can be cancelled before it starts", async () => {
    const first = deferred();
    const a = runExclusive(() => first.promise);
    const ctrl = new AbortController();
    let ran = false;
    const b = runExclusive(async () => { ran = true; }, { signal: ctrl.signal });
    ctrl.abort();
    await assert.rejects(b, /Cancelled/);
    first.resolve();
    await a;
    assert.equal(ran, false);
  });

  test("the abort listener for a queued job is removed once it starts running (Ruling 6)", async () => {
    const first = deferred();
    const a = runExclusive(() => first.promise);
    const ctrl = new AbortController();
    const b = runExclusive(async () => "b done", { signal: ctrl.signal });
    await new Promise((r) => setImmediate(r));
    assert.equal(getEventListeners(ctrl.signal, "abort").length, 1, "listener attached while queued");
    first.resolve();
    await a;
    await new Promise((r) => setImmediate(r));
    assert.equal(getEventListeners(ctrl.signal, "abort").length, 0, "listener removed once it starts running");
    assert.equal(await b, "b done");
    // Aborting after the job has already started must be a harmless no-op:
    // it must not reject a job that has already resolved, and must not throw.
    assert.doesNotThrow(() => ctrl.abort());
  });
});
