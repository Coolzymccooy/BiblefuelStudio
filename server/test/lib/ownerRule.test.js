import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwner, ownershipWarning, unverifiedAdminSignIn } from "../../src/lib/userPlan.js";

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try { return fn(); }
  finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

// Exactly one owner, by precedence: SUPER_ADMIN_USER_ID, else the first
// OWNER_EMAIL, else the first SUPER_ADMIN_EMAIL. A union would let two
// people share the main workspace again.

test("isOwner: SUPER_ADMIN_USER_ID is the only owner; the first admin email is then not", () => {
  withEnv({ SUPER_ADMIN_USER_ID: "u_a", OWNER_EMAIL: undefined, SUPER_ADMIN_EMAIL: "b@x.com, a@x.com" }, () => {
    assert.equal(isOwner({ sub: "u_a", email: "a@x.com" }), true);
    assert.equal(isOwner({ sub: "u_b", email: "b@x.com" }), false);
  });
});

test("isOwner: only the first OWNER_EMAIL is the owner", () => {
  withEnv({ SUPER_ADMIN_USER_ID: undefined, OWNER_EMAIL: "b@x.com, a@x.com", SUPER_ADMIN_EMAIL: "a@x.com, b@x.com" }, () => {
    assert.equal(isOwner({ sub: "u_b", email: "b@x.com" }), true);
    assert.equal(isOwner({ sub: "u_a", email: "a@x.com" }), false);
  });
});

test("ownershipWarning: several admins with no owner named is flagged, naming who owns", () => {
  withEnv({ SUPER_ADMIN_USER_ID: undefined, OWNER_EMAIL: undefined, SUPER_ADMIN_EMAIL: "a@x.com, b@x.com" }, () => {
    assert.match(ownershipWarning(), /a@x\.com owns the main workspace/);
    assert.match(ownershipWarning(), /OWNER_EMAIL/);
  });
});

test("ownershipWarning: an OWNER_EMAIL that is not a super-admin leaves nobody as owner, and says so", () => {
  withEnv({ SUPER_ADMIN_USER_ID: undefined, OWNER_EMAIL: "c@x.com", SUPER_ADMIN_EMAIL: "a@x.com, b@x.com" }, () => {
    assert.match(ownershipWarning(), /c@x\.com is not in SUPER_ADMIN_EMAIL/);
  });
});

test("ownershipWarning: none when there is one admin, or the owner is named", () => {
  withEnv({ SUPER_ADMIN_USER_ID: undefined, OWNER_EMAIL: undefined, SUPER_ADMIN_EMAIL: "a@x.com" }, () => {
    assert.equal(ownershipWarning(), null);
  });
  withEnv({ SUPER_ADMIN_USER_ID: undefined, OWNER_EMAIL: "a@x.com", SUPER_ADMIN_EMAIL: "a@x.com, b@x.com" }, () => {
    assert.equal(ownershipWarning(), null);
  });
});

// Admin emails skip the access-request gate and are matched by email alone,
// so an unverified Firebase account using an admin's address must not sign in.
test("unverifiedAdminSignIn: an admin email without email_verified is refused; verified or non-admin is not", () => {
  withEnv({ SUPER_ADMIN_USER_ID: undefined, SUPER_ADMIN_EMAIL: "a@x.com" }, () => {
    assert.equal(unverifiedAdminSignIn({ uid: "f1", email: "A@x.com", email_verified: false }), true);
    assert.equal(unverifiedAdminSignIn({ uid: "f1", email: "a@x.com" }), true);
    assert.equal(unverifiedAdminSignIn({ uid: "f1", email: "a@x.com", email_verified: true }), false);
    assert.equal(unverifiedAdminSignIn({ uid: "f2", email: "z@x.com", email_verified: false }), false);
  });
});
