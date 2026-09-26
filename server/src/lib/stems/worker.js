import fs from "fs";
import path from "path";

/**
 * The laptop worker's loop (scripts/stems-worker.mjs runs it): ask the live
 * site for a vocal-removal job, separate it here, send the instrumental back.
 * One job at a time, so the laptop stays usable.
 */

const AUDIO_EXTS = new Set([".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".mp4", ".webm"]);
// The lease on the server is 3 minutes; a report every 30 s keeps it alive
// even through a long stretch where the separator prints no progress.
const KEEPALIVE_MS = 30_000;

/** An HTTP client for /api/stems-worker. */
export function makeWorkerApi({ baseUrl, token, fetchImpl = fetch }) {
  const root = `${String(baseUrl).replace(/\/+$/, "")}/api/stems-worker`;
  const headers = { Authorization: `Bearer ${token}` };
  const call = async (method, route, { json, body, contentType } = {}) => {
    const res = await fetchImpl(`${root}${route}`, {
      method,
      headers: {
        ...headers,
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(contentType ? { "Content-Type": contentType } : {}),
      },
      body: json ? JSON.stringify(json) : body,
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json())?.error || ""; } catch { /* not JSON */ }
      throw new Error(`${method} ${route} → ${res.status}${detail ? ` (${detail})` : ""}`);
    }
    return res;
  };
  return {
    claim: async () => (await (await call("POST", "/claim")).json()).job || null,
    download: async (jobId, file) => {
      const res = await call("GET", `/jobs/${encodeURIComponent(jobId)}/source`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    },
    progress: async (jobId, percent) => (await call("POST", `/jobs/${encodeURIComponent(jobId)}/progress`, { json: { percent } })).json(),
    upload: async (jobId, file) => {
      await call("POST", `/jobs/${encodeURIComponent(jobId)}/result`, { body: fs.readFileSync(file), contentType: "audio/mp4" });
    },
    fail: async (jobId, error) => { await call("POST", `/jobs/${encodeURIComponent(jobId)}/fail`, { json: { error } }); },
  };
}

/** Wait before the next try after `failures` network errors in a row. */
export function nextDelay(failures) {
  return Math.min(60_000, 5_000 * 2 ** Math.max(0, failures));
}

/**
 * Claim and finish at most one job. Resolves "idle", "done", "failed" or
 * "cancelled"; throws only when the server cannot be reached.
 */
export async function workOnce({ api, remove, tmpRoot, progressEveryMs = 3_000, log = () => {} }) {
  const job = await api.claim();
  if (!job) return "idle";
  log(`job ${job.jobId}: ${job.sourceName} (${job.quality})`);

  const dir = fs.mkdtempSync(path.join(tmpRoot, "bf-stems-"));
  const ext = path.extname(String(job.sourceName || "")).toLowerCase();
  // Only the extension is taken from the server, and only a known audio one.
  const input = path.join(dir, `source${AUDIO_EXTS.has(ext) ? ext : ".audio"}`);
  const outPath = path.join(dir, "instrumental.m4a");
  const controller = new AbortController();
  let percent = 0;
  let lastSent = 0;

  const report = async () => {
    lastSent = Date.now();
    try {
      const r = await api.progress(job.jobId, percent);
      if (r?.cancelled) controller.abort();
    } catch (e) {
      log(`progress not delivered: ${e.message}`);
    }
  };
  const keepalive = setInterval(report, KEEPALIVE_MS);

  try {
    await api.download(job.jobId, input);
    await remove({
      input,
      outPath,
      workDir: path.join(dir, "work"),
      quality: job.quality === "fast" ? "fast" : "best",
      signal: controller.signal,
      onProgress: (p) => {
        percent = p;
        if (Date.now() - lastSent >= progressEveryMs) report();
      },
    });
    if (controller.signal.aborted) return "cancelled";
    await api.upload(job.jobId, outPath);
    log(`job ${job.jobId}: done`);
    return "done";
  } catch (e) {
    if (controller.signal.aborted) {
      log(`job ${job.jobId}: cancelled`);
      return "cancelled";
    }
    const message = String(e?.message || e);
    log(`job ${job.jobId}: failed — ${message}`);
    try { await api.fail(job.jobId, message); } catch { /* the lease lapses and the server retries it */ }
    return "failed";
  } finally {
    clearInterval(keepalive);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp folder; the OS clears it */ }
  }
}

/** Run until `signal` aborts: work when there is work, poll quietly when not. */
export async function runWorker({ api, remove, tmpRoot, signal, log = console.log, idleMs = 5_000 }) {
  const sleep = (ms) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
  let failures = 0;
  let wasDown = false;
  while (!signal?.aborted) {
    try {
      const outcome = await workOnce({ api, remove, tmpRoot, log });
      if (wasDown) log("connected to Biblefuel again");
      failures = 0;
      wasDown = false;
      if (outcome === "idle") await sleep(idleMs);
    } catch (e) {
      if (!wasDown) log(`cannot reach Biblefuel: ${e.message}`);
      wasDown = true;
      await sleep(nextDelay(failures));
      failures += 1;
    }
  }
}
