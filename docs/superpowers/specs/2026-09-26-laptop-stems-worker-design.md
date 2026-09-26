# Laptop worker for vocal removal — design

Approved by the operator on 2026-09-26 ("proceed").

## Problem

Vocal removal needs the `audio-separator` tool, which is installed only on the operator's
laptop. The live site (Coolify) cannot run it, so `/api/music/capabilities` answers
`vocalRemoval: false` and every "Remove vocals" control is hidden, even while the operator is
at the laptop. The browser cannot reach the laptop; the server has to be connected to it.

## Design

### Server: a queue the laptop drains

- `POST /api/music/:id/instrumental`, when the server has no separator of its own but a worker
  key is configured (`STEMS_WORKER_TOKEN`, at least 32 characters), creates the job with
  `where: "laptop"`, status `queued`, instead of answering 409. A server with its own separator
  keeps running jobs itself, exactly as today.
- Queued laptop jobs are persisted to `DATA_DIR/stems-queue.json`, so a deploy or restart does
  not lose requests made while the laptop was off. On start they are reloaded as `queued`.
- `GET /api/music/capabilities` → `{ vocalRemoval, vocalRemovalWhere: "server" | "laptop" | null,
  laptopOnline, amfEncoder }`. `vocalRemoval` is true when either path can take the job, so every
  existing "Remove vocals" control appears on the live site with no client change.
- The job view gains `where` and `laptopOnline`.

### Worker API — `/api/stems-worker`, mounted without user auth

Every route needs `Authorization: Bearer <STEMS_WORKER_TOKEN>` (constant-time compare; 503
when the key is unset or too short, 401 when wrong). The key reaches only these routes.

| Route | Does |
|---|---|
| `POST /claim` | Records a heartbeat. Returns expired leases to the queue, then leases the oldest queued job (`{ job: { jobId, quality, sourceName } }`) or `{ job: null }`. |
| `GET /jobs/:id/source` | Streams the source audio of a job this worker holds. |
| `POST /jobs/:id/progress` | `{ percent }` → renews the lease; answers `{ cancelled }` so the worker stops a cancelled job. |
| `POST /jobs/:id/result` | Raw audio body (≤ 300 MB). Written to a server-chosen `instrumental-<jobId>.m4a`, checked to be an MP4/M4A container and probed for a duration, then saved to the library as today. |
| `POST /jobs/:id/fail` | `{ error }` → the job fails with that message (trimmed, 300 chars). |

- Lease: 3 minutes, renewed by progress (the worker reports at least every 30 s). An expired
  lease returns the job to the queue; after 3 attempts it fails with a clear message.
- The laptop counts as online when it claimed within the last 45 seconds.
- Cancel: a queued laptop job fails at once as "Cancelled."; a running one is flagged, the
  worker stops at its next progress report, and a late result is refused.

### Laptop: `npm run stems-worker` (in `server/`)

- Reads `STEMS_WORKER_TOKEN` and `BIBLEFUEL_URL` (default `https://biblefuel.tiwaton.co.uk`)
  from the environment or `server/.env`.
- Loop: claim → download the source to a temp folder → `removeVocals` (the existing separator
  wrapper) with progress reported every few seconds → upload the result → clean up. Idle poll
  every 5 s; network failures back off up to 60 s. One job at a time.
- `server/scripts/install-stems-worker.ps1` registers a Task Scheduler task that starts the
  worker at log-on. The operator runs it once; nothing is registered without them.

### Client

- The dialog says "Waiting for your laptop" / "Your laptop is offline — this runs when it's
  back" for a queued laptop job, and "Removing vocals on your laptop… N%" while it runs.

## Security

- The worker key is a new secret, separate from user logins, stored only in Coolify and the
  laptop's `server/.env`. The operator pastes it into Coolify.
- The worker can only read the source of a job it holds and write that job's result; file
  names are chosen by the server; uploads are size-capped and must be real audio.

## Testing

- Server (`node:test`): queue creation when no local separator; persistence and reload;
  claim/lease/expiry/attempt cap; key refused when unset, short or wrong; source only for the
  holder; result validation (not audio → 400, cancelled → 409); capabilities online/offline.
- Client (Vitest): laptop waiting/offline/running wording.
- End to end: a live-site request processed by the laptop worker, landing in the live library.
