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
  // A queued entry's abort listener is only useful while it sits in the
  // queue (to cancel it before it runs); once it starts, leaving the
  // listener attached to the caller's signal would keep it alive for
  // nothing until that signal fires or is garbage-collected.
  if (entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
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
    if (signal) {
      entry.signal = signal;
      entry.onAbort = () => {
        const i = queue.indexOf(entry);
        if (i >= 0) {
          queue.splice(i, 1);
          reject(new Error("Cancelled."));
        }
      };
      signal.addEventListener("abort", entry.onAbort, { once: true });
    }
    try { onQueued?.(); } catch { /* a progress write must not break the queue */ }
    return undefined;
  });
}

/** Tests only. */
export function _resetHeavyGate() {
  active = false;
  queue.length = 0;
}
