//
// Append-only JSON store for landing-page access requests.
// Single-process write serialisation via a Promise-chain queue —
// no external lockfile dep needed because this server runs as one process.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = 'access-requests.json';

export function createAccessRequestsStore({ dir }) {
  let queue = Promise.resolve();

  const filePath = () => path.join(dir, FILE);

  const ensure = () => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath())) fs.writeFileSync(filePath(), '[]', 'utf8');
  };

  const append = async (record) => {
    const enriched = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...record,
    };

    const next = queue.then(async () => {
      ensure();
      const raw = await fs.promises.readFile(filePath(), 'utf8');
      let arr;
      try { arr = JSON.parse(raw); } catch { arr = []; }
      if (!Array.isArray(arr)) arr = [];
      arr.push(enriched);
      await fs.promises.writeFile(filePath(), JSON.stringify(arr, null, 2), 'utf8');
      return enriched;
    });

    queue = next.catch(() => {}); // keep the queue alive even if a write fails
    return next;
  };

  return { append, filePath };
}
