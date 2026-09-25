#!/usr/bin/env node
// Free a TCP port before `npm run dev` binds it. Solves the recurring
// EADDRINUSE on Windows where `node --watch` orphans its child process
// when the npm/concurrently wrapper is Ctrl-C'd, leaving the port held
// by a node.exe that has no parent to forward signals from.
//
// Usage: node scripts/free-port.mjs <port>
// Exit:  0 on success or no-op, never 1 (predev should never block dev).
//
// Cross-platform: uses `netstat`/`taskkill` on Windows, `lsof`/`kill` on
// macOS/Linux. Silent on success; logs the killed PID(s) so the user
// knows what happened.

import { execSync, spawnSync } from "node:child_process";

const port = Number(process.argv[2]);
if (!Number.isFinite(port) || port <= 0) {
  console.error("free-port: invalid port");
  process.exit(0);
}

function pidsOnPortWindows(p) {
  // `netstat -ano | findstr` is more robust than PowerShell here — it
  // works in cmd, PowerShell, Git Bash, and WSL-mounted Windows alike.
  try {
    const out = execSync(`netstat -ano -p tcp`, { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      // " TCP 0.0.0.0:5051 0.0.0.0:0 LISTENING 12345"
      const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
      if (m && Number(m[1]) === p) pids.add(Number(m[2]));
    }
    return [...pids];
  } catch {
    return [];
  }
}

function pidsOnPortPosix(p) {
  const r = spawnSync("lsof", ["-iTCP", `-i:${p}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout.split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite);
}

function kill(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/F", "/PID", String(pid)], { stdio: "ignore" });
  } else {
    try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
  }
}

const pids = process.platform === "win32" ? pidsOnPortWindows(port) : pidsOnPortPosix(port);

if (pids.length === 0) {
  process.exit(0);
}

for (const pid of pids) {
  console.log(`[predev] freeing port ${port} — killing orphan PID ${pid}`);
  kill(pid);
}

// Brief settle so the next `node --watch index.js` doesn't race the
// SIGKILL and still see the socket as in-use.
const until = Date.now() + 800;
while (Date.now() < until) { /* spin */ }

process.exit(0);
