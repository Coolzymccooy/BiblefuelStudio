import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSuperAdmin } from '../../src/lib/userPlan.js';

function withEnv(env, fn) {
  const original = {};
  for (const k of Object.keys(env)) {
    original[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(original)) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  }
}

test('isSuperAdmin: matches single SUPER_ADMIN_EMAIL', () => {
  withEnv({ SUPER_ADMIN_EMAIL: 'ops@example.com', SUPER_ADMIN_USER_ID: undefined }, () => {
    assert.equal(isSuperAdmin({ email: 'ops@example.com' }), true);
    assert.equal(isSuperAdmin({ email: 'someone@else.com' }), false);
  });
});

test('isSuperAdmin: case-insensitive on email', () => {
  withEnv({ SUPER_ADMIN_EMAIL: 'OPS@Example.com', SUPER_ADMIN_USER_ID: undefined }, () => {
    assert.equal(isSuperAdmin({ email: 'ops@example.com' }), true);
    assert.equal(isSuperAdmin({ email: 'OPS@EXAMPLE.COM' }), true);
  });
});

test('isSuperAdmin: accepts comma-separated list', () => {
  withEnv({ SUPER_ADMIN_EMAIL: 'a@x.y, b@x.y,c@x.y', SUPER_ADMIN_USER_ID: undefined }, () => {
    assert.equal(isSuperAdmin({ email: 'a@x.y' }), true);
    assert.equal(isSuperAdmin({ email: 'b@x.y' }), true);
    assert.equal(isSuperAdmin({ email: 'c@x.y' }), true);
    assert.equal(isSuperAdmin({ email: 'd@x.y' }), false);
  });
});

test('isSuperAdmin: accepts semicolon-separated list (Windows-friendly)', () => {
  withEnv({ SUPER_ADMIN_EMAIL: 'a@x.y;b@x.y', SUPER_ADMIN_USER_ID: undefined }, () => {
    assert.equal(isSuperAdmin({ email: 'a@x.y' }), true);
    assert.equal(isSuperAdmin({ email: 'b@x.y' }), true);
  });
});

test('isSuperAdmin: empty/whitespace tokens are ignored', () => {
  withEnv({ SUPER_ADMIN_EMAIL: '  ,  ,a@x.y , ', SUPER_ADMIN_USER_ID: undefined }, () => {
    assert.equal(isSuperAdmin({ email: 'a@x.y' }), true);
    assert.equal(isSuperAdmin({ email: '' }), false, 'empty user email must not match empty tokens');
  });
});

test('isSuperAdmin: SUPER_ADMIN_USER_ID single-value match', () => {
  withEnv({ SUPER_ADMIN_EMAIL: undefined, SUPER_ADMIN_USER_ID: 'u_abc' }, () => {
    assert.equal(isSuperAdmin({ sub: 'u_abc' }), true);
    assert.equal(isSuperAdmin({ sub: 'u_xyz' }), false);
  });
});

test('isSuperAdmin: neither env set → never super-admin', () => {
  withEnv({ SUPER_ADMIN_EMAIL: undefined, SUPER_ADMIN_USER_ID: undefined }, () => {
    assert.equal(isSuperAdmin({ email: 'ops@example.com', sub: 'u_abc' }), false);
  });
});

test('isSuperAdmin: undefined user → false (no crash)', () => {
  withEnv({ SUPER_ADMIN_EMAIL: 'ops@x.y', SUPER_ADMIN_USER_ID: undefined }, () => {
    assert.equal(isSuperAdmin(undefined), false);
    assert.equal(isSuperAdmin(null), false);
  });
});
