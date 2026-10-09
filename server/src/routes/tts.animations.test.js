import { test } from "node:test";
import assert from "node:assert/strict";
import router from "./tts.js";

function call(pathName) {
  const layer = router.stack.find((l) => l.route?.path === pathName && l.route.methods.get);
  return new Promise((resolve) => {
    const res = { json: (body) => resolve(body), status() { return res; } };
    layer.route.stack[0].handle({ query: {}, body: {} }, res, () => resolve(null));
  });
}

test("the caption catalogue lists studio looks, energies and whether libass is here", async () => {
  const body = await call("/animations");
  assert.equal(body.ok, true);
  assert.deepEqual(body.studioLooks.map((l) => l.id), ["studio-lagos-night", "studio-gospel-gold", "studio-clean-white"]);
  assert.deepEqual(body.energies.map((e) => e.id), ["calm", "lively", "wild"]);
  assert.equal(typeof body.libass, "boolean");
  assert.ok(Array.isArray(body.animations) && Array.isArray(body.motions));
});
