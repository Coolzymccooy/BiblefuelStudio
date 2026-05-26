import fs from "fs";
import path from "path";

function queuePath(dataDir) {
  if (!dataDir) throw new Error("queue: dataDir required");
  return path.join(dataDir, "queue.json");
}
function logPath(dataDir) {
  return path.join(dataDir, "debug.log");
}

function log(dataDir, msg) {
  try {
    fs.appendFileSync(logPath(dataDir), `${new Date().toISOString()} - ${msg}\n`);
  } catch { /* best-effort */ }
}

function ensure(dataDir) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const f = queuePath(dataDir);
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, JSON.stringify({ items: [] }, null, 2));
    log(dataDir, "Created queue.json");
  }
}

export function readQueue(dataDir) {
  ensure(dataDir);
  const data = JSON.parse(fs.readFileSync(queuePath(dataDir), "utf-8"));
  return data;
}

export function writeQueue(dataDir, data) {
  ensure(dataDir);
  fs.writeFileSync(queuePath(dataDir), JSON.stringify(data, null, 2));
}

export function appendQueueItem(dataDir, item) {
  const q = readQueue(dataDir);
  q.items.unshift(item);
  writeQueue(dataDir, q);
  return item;
}

export function deleteQueueItem(dataDir, id) {
  const q = readQueue(dataDir);
  const before = q.items.length;
  q.items = q.items.filter((it) => it.id !== id);
  if (q.items.length !== before) {
    writeQueue(dataDir, q);
    return true;
  }
  return false;
}

export function clearQueue(dataDir) {
  writeQueue(dataDir, { items: [] });
  return true;
}
