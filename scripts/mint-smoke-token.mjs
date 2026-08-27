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
  { sub: 'smoke-test-user', email: 'smoke@local.test', role: 'user', emailVerified: true },
  secret,
  { expiresIn: '12h' },
);
fs.writeFileSync(path.join(root, 'tok.txt'), token);
console.log('token written to tok.txt (12h expiry)');
