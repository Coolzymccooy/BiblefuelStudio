//
// JSON store for landing-page access requests with approve/deny tracking.
// Single-process write serialisation via a Promise-chain queue —
// no external lockfile dep needed because this server runs as one process.
//
// Records gain a `status` field ('pending' | 'approved' | 'denied') plus
// `reviewedAt` and `reviewedBy` once a super-admin acts on them. Records
// written before this field existed are treated as 'pending' on read.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './paths.js';

const FILE = 'access-requests.json';
const VALID_STATUSES = new Set(['pending', 'approved', 'denied']);

/**
 * Process-wide singleton so the public submission router AND the admin
 * approve/deny router share the SAME write queue + file handle. Without
 * this, two independent stores could race on writes.
 */
let _shared = null;
export function getAccessRequestsStore() {
  if (!_shared) _shared = createAccessRequestsStore({ dir: DATA_DIR });
  return _shared;
}

export function createAccessRequestsStore({ dir }) {
  let queue = Promise.resolve();

  const filePath = () => path.join(dir, FILE);

  const ensure = () => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath())) fs.writeFileSync(filePath(), '[]', 'utf8');
  };

  const normalize = (rec) => ({
    ...rec,
    status: VALID_STATUSES.has(rec?.status) ? rec.status : 'pending',
  });

  const readAll = async () => {
    ensure();
    const raw = await fs.promises.readFile(filePath(), 'utf8');
    let arr;
    try { arr = JSON.parse(raw); } catch { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    return arr;
  };

  const writeAll = async (arr) => {
    await fs.promises.writeFile(filePath(), JSON.stringify(arr, null, 2), 'utf8');
  };

  const append = async (record) => {
    const enriched = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      ...record,
    };

    const next = queue.then(async () => {
      const arr = await readAll();
      arr.push(enriched);
      await writeAll(arr);
      return enriched;
    });

    queue = next.catch(() => {}); // keep the queue alive even if a write fails
    return next;
  };

  /**
   * Returns every request, oldest first, with `status` normalized so legacy
   * records (written before the field existed) show as 'pending'.
   */
  const list = async () => {
    const arr = await readAll();
    return arr.map(normalize);
  };

  /**
   * Mutate a single request's status. Throws if id is unknown or status is
   * not one of pending|approved|denied.
   *
   * @param {string} id
   * @param {'pending'|'approved'|'denied'} status
   * @param {{ email?: string, userId?: string }} [reviewer]
   */
  const setStatus = async (id, status, reviewer = {}) => {
    if (!VALID_STATUSES.has(status)) {
      throw new Error(`status must be one of ${[...VALID_STATUSES].join(', ')}`);
    }

    const next = queue.then(async () => {
      const arr = await readAll();
      const idx = arr.findIndex((r) => r?.id === id);
      if (idx < 0) throw new Error(`request ${id} not found`);
      const reviewedAt = new Date().toISOString();
      const reviewedBy = reviewer?.email || reviewer?.userId || 'super-admin';
      arr[idx] = { ...normalize(arr[idx]), status, reviewedAt, reviewedBy };
      await writeAll(arr);
      return arr[idx];
    });

    queue = next.catch(() => {});
    return next;
  };

  /**
   * Lowercase-trimmed email lookup. Returns the latest approved record for
   * the email, or null if none. Powers the signup gate in slice 3.
   */
  const findApprovedByEmail = async (email) => {
    const target = String(email || '').trim().toLowerCase();
    if (!target) return null;
    const arr = await readAll();
    const matches = arr
      .map(normalize)
      .filter((r) => r.status === 'approved' && String(r.email || '').trim().toLowerCase() === target);
    if (matches.length === 0) return null;
    return matches.reduce((latest, r) => {
      const a = Date.parse(r.reviewedAt || r.createdAt || '') || 0;
      const b = Date.parse(latest.reviewedAt || latest.createdAt || '') || 0;
      return a > b ? r : latest;
    });
  };

  return { append, list, setStatus, findApprovedByEmail, filePath };
}
