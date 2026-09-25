import { test } from "node:test";
import assert from "node:assert/strict";
import { getPlanForUser, isSuperAdmin } from "../../src/lib/userPlan.js";

test("isSuperAdmin: email match (case-insensitive)", () => {
  const prev = process.env.SUPER_ADMIN_EMAIL;
  process.env.SUPER_ADMIN_EMAIL = "Admin@Example.com";
  try {
    assert.equal(isSuperAdmin({ email: "admin@example.com" }), true);
    assert.equal(isSuperAdmin({ email: "other@example.com" }), false);
  } finally {
    if (prev === undefined) delete process.env.SUPER_ADMIN_EMAIL;
    else process.env.SUPER_ADMIN_EMAIL = prev;
  }
});

test("isSuperAdmin: user_id fallback", () => {
  const prevE = process.env.SUPER_ADMIN_EMAIL;
  const prevI = process.env.SUPER_ADMIN_USER_ID;
  delete process.env.SUPER_ADMIN_EMAIL;
  process.env.SUPER_ADMIN_USER_ID = "u_123";
  try {
    assert.equal(isSuperAdmin({ sub: "u_123", email: "" }), true);
    assert.equal(isSuperAdmin({ sub: "u_999", email: "" }), false);
  } finally {
    if (prevE !== undefined) process.env.SUPER_ADMIN_EMAIL = prevE;
    if (prevI === undefined) delete process.env.SUPER_ADMIN_USER_ID;
    else process.env.SUPER_ADMIN_USER_ID = prevI;
  }
});

test("isSuperAdmin: no env vars set => false", () => {
  const prevE = process.env.SUPER_ADMIN_EMAIL;
  const prevI = process.env.SUPER_ADMIN_USER_ID;
  delete process.env.SUPER_ADMIN_EMAIL;
  delete process.env.SUPER_ADMIN_USER_ID;
  try {
    assert.equal(isSuperAdmin({ sub: "u_1", email: "x@y" }), false);
  } finally {
    if (prevE !== undefined) process.env.SUPER_ADMIN_EMAIL = prevE;
    if (prevI !== undefined) process.env.SUPER_ADMIN_USER_ID = prevI;
  }
});

test("isSuperAdmin: undefined user => false", () => {
  assert.equal(isSuperAdmin(undefined), false);
});

test("getPlanForUser: super-admin email => super_admin", () => {
  const prev = process.env.SUPER_ADMIN_EMAIL;
  process.env.SUPER_ADMIN_EMAIL = "admin@example.com";
  try {
    assert.equal(getPlanForUser({ email: "admin@example.com" }), "super_admin");
  } finally {
    if (prev === undefined) delete process.env.SUPER_ADMIN_EMAIL;
    else process.env.SUPER_ADMIN_EMAIL = prev;
  }
});

test("getPlanForUser: regular user => free", () => {
  const prev = process.env.SUPER_ADMIN_EMAIL;
  delete process.env.SUPER_ADMIN_EMAIL;
  try {
    assert.equal(getPlanForUser({ email: "user@example.com" }), "free");
  } finally {
    if (prev !== undefined) process.env.SUPER_ADMIN_EMAIL = prev;
  }
});
