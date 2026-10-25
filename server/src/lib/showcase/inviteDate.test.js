import { test } from "node:test";
import assert from "node:assert/strict";
import { readInviteDate } from "./inviteDate.js";

const NOV21 = { month: 11, day: 21, label: "NOV" };

test("common ways of writing a date read as day and month", () => {
  for (const text of ["21 November", "21st Nov", "November 21", "21/11", "2026-11-21", "Sat 21 Nov 2026", "Saturday, 21st of November", "nov 21st"]) {
    assert.deepEqual(readInviteDate(text), NOV21, text);
  }
  assert.deepEqual(readInviteDate("1/2/2027"), { month: 2, day: 1, label: "FEB" }, "slashes are day first (UK)");
  assert.deepEqual(readInviteDate("29 Feb"), { month: 2, day: 29, label: "FEB" });
  assert.deepEqual(readInviteDate("21.11.2026"), NOV21, "dots count only with a year, so a time never reads as a date");
});

test("anything that is not a real day and month gives null", () => {
  for (const text of ["13/14", "next Sunday", "", "31 February", "32 May", "Nov", "7.5", "starts 6.30", undefined, null, 42]) {
    assert.equal(readInviteDate(text), null, String(text));
  }
});
