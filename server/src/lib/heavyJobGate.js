/**
 * One heavy job at a time on this machine.
 *
 * A two-hour Ambient encode and an AI vocal separation each hold every CPU
 * core for many minutes, and the separation needs several GB of RAM. Run
 * together they are both far slower and can exhaust memory, so they queue
 * behind each other here. In-process only: this server is one process.
 */
let active = false;
const queue = [];

export function isHeavyBusy() {
  return active;
}

function start(entry) {
  active = true;
  Promise.resolve()
    .then(entry.task)
    .then(entry.resolve, entry.reject)
    .finally(() => {
      active = false;
      const next = queue.shift();
      if (next) start(next);
    });
}

/**
 * @template T
 * @param {() => Promise<T>} task
 * @param {{ onQueued?: () => void, signal?: AbortSignal }} [opts]
 * @returns {Promise<T>}
 */
export function runExclusive(task, { onQueued, signal } = {}) {
  return new Promise((resolve, reject) => {
    const entry = { task, resolve, reject };
    if (!active) return start(entry);
    queue.push(entry);
    signal?.addEventListener("abort", () => {
      const i = queue.indexOf(entry);
      if (i >= 0) {
        queue.splice(i, 1);
        reject(new Error("Cancelled."));
      }
    }, { once: true });
    try { onQueued?.(); } catch { /* a progress write must not break the queue */ }
    return undefined;
  });
}

/** Tests only. */
export function _resetHeavyGate() {
  active = false;
  queue.length = 0;
}
