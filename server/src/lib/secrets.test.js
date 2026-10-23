import assert from "node:assert/strict";
import test from "node:test";

import { sameSecret } from "./secrets.js";

test("sameSecret: equal strings true, different false, non-strings coerced", () => {
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abc", "abd"), false);
  assert.equal(sameSecret("", "x"), false);
  assert.equal(sameSecret(123, "123"), true);
});
