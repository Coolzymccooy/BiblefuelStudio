import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLES, DEFAULT_STYLE, styleId, isStyleName } from "./styles.js";

test("a prototype key never names a style", () => {
  for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty", "prototype"]) {
    assert.equal(styleId(key), DEFAULT_STYLE, key);
    assert.equal(isStyleName(key), false, key);
    assert.ok(STYLES[styleId(key)].label, key);
  }
});

test("isStyleName accepts ids, labels and short names only", () => {
  for (const name of ["family3d", "Storybook", " 3D family film ", "3d", "clay", "Claymation"]) assert.equal(isStyleName(name), true, name);
  for (const name of ["", "  ", "garbage", null, undefined, 3, {}]) assert.equal(isStyleName(name), false, String(name));
});
