//
// JSON store for user-reported issues. Mirrors accessRequestsStore.js
// shape — Promise-chain write queue, lazy ensure(), normalize-on-read.
//
// Record shape:
//   { id, createdAt, reporterEmail, reporterId, title, body, severity,
//     contextPath, attachments?, status, resolvedAt?, resolvedBy?,
//     resolutionNote?, replies: [{ id, at, byEmail, byUserId, isAdmin, body }] }
//
// status: 'open' | 'resolved'
//
// Reporters can read their OWN issues (incl. admin replies) via the
// /api/issues/mine endpoint and can post follow-up replies. Only super-admin
// reads the full list across reporters.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './paths.js';

const FILE = 'issues.json';
const VALID_STATUSES = new Set(['open', 'resolved']);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);

let _shared = null;
export function getIssuesStore() {
  if (!_shared) _shared = createIssuesStore({ dir: DATA_DIR });
  return _shared;
}

export function createIssuesStore({ dir }) {
  let queue = Promise.resolve();

  const filePath = () => path.join(dir, FILE);

  const ensure = () => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath())) fs.writeFileSync(filePath(), '[]', 'utf8');
  };

  const normalize = (rec) => ({
    ...rec,
    status: VALID_STATUSES.has(rec?.status) ? rec.status : 'open',
    severity: VALID_SEVERITIES.has(rec?.severity) ? rec.severity : 'medium',
    // Legacy issues filed before reply-thread support get an empty array on
    // read so callers never have to null-check before mapping.
    replies: Array.isArray(rec?.replies) ? rec.replies : [],
    attachments: Array.isArray(rec?.attachments) ? rec.attachments : [],
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

  /**
   * @param {{ reporterEmail: string, reporterId?: string, title: string,
   *   body: string, severity?: 'low'|'medium'|'high', contextPath?: string }} record
   */
  const append = async (record) => {
    const enriched = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'open',
      severity: VALID_SEVERITIES.has(record?.severity) ? record.severity : 'medium',
      reporterEmail: String(record?.reporterEmail || '').trim(),
      reporterId: String(record?.reporterId || '').trim(),
      title: String(record?.title || '').trim(),
      body: String(record?.body || '').trim(),
      contextPath: String(record?.contextPath || '').trim(),
      attachments: Array.isArray(record?.attachments) ? record.attachments : [],
      replies: [],
    };

    const next = queue.then(async () => {
      const arr = await readAll();
      arr.push(enriched);
      await writeAll(arr);
      return enriched;
    });
    queue = next.catch(() => {});
    return next;
  };

  const list = async () => {
    const arr = await readAll();
    return arr.map(normalize);
  };

  /**
   * @param {string} id
   * @param {'open'|'resolved'} status
   * @param {{ email?: string, userId?: string, note?: string }} [reviewer]
   */
  const setStatus = async (id, status, reviewer = {}) => {
    if (!VALID_STATUSES.has(status)) {
      throw new Error(`status must be one of ${[...VALID_STATUSES].join(', ')}`);
    }
    const next = queue.then(async () => {
      const arr = await readAll();
      const idx = arr.findIndex((r) => r?.id === id);
      if (idx < 0) throw new Error(`issue ${id} not found`);
      const patch = { ...normalize(arr[idx]), status };
      if (status === 'resolved') {
        patch.resolvedAt = new Date().toISOString();
        patch.resolvedBy = reviewer?.email || reviewer?.userId || 'super-admin';
        if (reviewer?.note) patch.resolutionNote = String(reviewer.note).trim();
      } else {
        // Reopen — clear resolution fields so the history is honest.
        delete patch.resolvedAt;
        delete patch.resolvedBy;
        delete patch.resolutionNote;
      }
      arr[idx] = patch;
      await writeAll(arr);
      return arr[idx];
    });
    queue = next.catch(() => {});
    return next;
  };

  const findById = async (id) => {
    const arr = await readAll();
    const rec = arr.find((r) => r?.id === id);
    return rec ? normalize(rec) : null;
  };

  const listByReporter = async (reporterId) => {
    const target = String(reporterId || '').trim();
    if (!target) return [];
    const arr = await readAll();
    return arr
      .filter((r) => String(r?.reporterId || '').trim() === target)
      .map(normalize);
  };

  /**
   * Append a reply to an existing issue thread.
   *
   * @param {string} issueId
   * @param {{ body: string, byEmail?: string, byUserId?: string, isAdmin?: boolean }} reply
   */
  const appendReply = async (issueId, reply) => {
    const body = String(reply?.body || '').trim();
    if (!body) throw new Error('reply body required');
    if (body.length > 4000) throw new Error('reply body too long (max 4000)');

    const entry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      byEmail: String(reply?.byEmail || '').trim(),
      byUserId: String(reply?.byUserId || '').trim(),
      isAdmin: Boolean(reply?.isAdmin),
      body,
    };

    const next = queue.then(async () => {
      const arr = await readAll();
      const idx = arr.findIndex((r) => r?.id === issueId);
      if (idx < 0) throw new Error(`issue ${issueId} not found`);
      const current = normalize(arr[idx]);
      const patch = { ...current, replies: [...current.replies, entry] };
      arr[idx] = patch;
      await writeAll(arr);
      return { issue: patch, reply: entry };
    });
    queue = next.catch(() => {});
    return next;
  };

  return { append, list, setStatus, findById, listByReporter, appendReply, filePath };
}
