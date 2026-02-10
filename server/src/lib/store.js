import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure we are relative to the server root, not the current working directory
const DATA_DIR = path.resolve(__dirname, "../../data");
const QUEUE_FILE = path.join(DATA_DIR, "queue.json");
const LOG_FILE = path.join(DATA_DIR, "../debug.log");

function log(msg) {
  const line = `${new Date().toISOString()} - ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(QUEUE_FILE)) {
    log("Creating initial queue.json");
    fs.writeFileSync(QUEUE_FILE, JSON.stringify({ items: [] }, null, 2));
  }
}

export function readQueue() {
  ensure();
  const data = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"));
  log(`Read Queue: ${data.items?.length || 0} items`);
  return data;
}

export function writeQueue(data) {
  ensure();
  log(`Writing Queue: ${data.items?.length || 0} items`);
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2));
}

export function appendQueueItem(item) {
  const q = readQueue();
  log(`Appending item: ${item.title || item.id}`);
  q.items.unshift(item);
  writeQueue(q);
  return item;
}

export function deleteQueueItem(id) {
  const q = readQueue();
  const initialLen = q.items.length;
  q.items = q.items.filter(item => item.id !== id);
  if (q.items.length !== initialLen) {
    writeQueue(q);
    return true;
  }
  return false;
}

export function clearQueue() {
  writeQueue({ items: [] });
  return true;
}
