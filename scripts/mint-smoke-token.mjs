// Mint a short-lived JWT for the local smoke suites (smoke:editor /
// smoke:studio), signed with the dev server's own secret. Local-dev only:
// reads server/.env in-process and never prints the secret.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'server', 'index.js'));
const jwt = require('jsonwebtoken');

let secret = process.env.JWT_SECRET || '';
if (!secret) {
  const env = fs.readFileSync(path.join(root, 'server', '.env'), 'utf8');
  const m = env.match(/^\s*JWT_SECRET\s*=\s*"?([^"\r\n]+)"?\s*$/m);
  secret = m ? m[1] : 'dev_secret_change_me';
}

const token = jwt.sign(
  // SMOKE_SUB / SMOKE_EMAIL let a probe run as another local user (e.g. the
  // super-admin email from server/.env) to reproduce plan-specific paths.
  { sub: process.env.SMOKE_SUB || 'smoke-test-user', email: process.env.SMOKE_EMAIL || 'smoke@local.test', role: 'user', emailVerified: true },
  secret,
  { expiresIn: '12h' },
);
const out = process.env.SMOKE_OUT || 'tok.txt';
fs.writeFileSync(path.join(root, out), token);
console.log(`token written to ${out} (12h expiry)`);
