/**
 * The order of work for one film run (spec section 7.6).
 *
 * Fresh shots start at once, a few at a time. A chained shot starts only after
 * the shot before it has finished in this run, because its first frame is that
 * clip's last frame. A parent outside the run (already made, or not picked) is
 * not waited for. This module only decides when each shot runs; whether a
 * chained shot may go ahead once its parent has finished is the caller's call.
 */

/** A runner that keeps at most `max` tasks going at once, started in arrival order. */
export function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active += 1;
    const { task, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    next();
  });
}

/**
 * Run every id in `ids` through `run(id)`, at most `concurrency` at once.
 * `parentOf(id)` names the shot this one waits for, or null. A parent that
 * throws still releases its child (the caller decides what the child does).
 * Resolves with Promise.allSettled results, in the order of `ids`.
 */
export function runInOrder(ids, { parentOf, run, concurrency }) {
  const wanted = new Set(ids);
  const limit = limiter(concurrency);
  const started = new Map();
  const start = (id) => {
    if (!started.has(id)) {
      const parent = parentOf(id);
      const after = parent && parent !== id && wanted.has(parent)
        ? start(parent).catch(() => undefined)
        : Promise.resolve();
      started.set(id, after.then(() => limit(() => run(id))));
    }
    return started.get(id);
  };
  return Promise.allSettled(ids.map(start));
}
