# Scaling BibleFuel to 20,000 users

Status: plan, 2026-10-23. Not started. Each phase below is tracked as its own issue on Dunni.

## 1. Goal

Serve about 20,000 signed-up users, with up to 10% active on a given day, without losing work, money or data. The target load:

- about **2,000 renders a day**, with peaks of 4 times the average;
- every render finishes, even across a deploy;
- every paid AI call is paid for by the user who asked for it.

Not in scope: new product features. This plan changes how the app runs, not what it does.

## 2. Where we are today (surveyed on master `06f6bd25`)

| Area | Today | Why it stops working at 20k |
|---|---|---|
| Process | One Node process on one Coolify box (8 cores, 15.6 GB RAM, no swap; 7.7 GB disk free on 12 Oct). | Everything below shares one CPU budget and one point of failure. |
| Heavy jobs | Run inside the web server. `heavyJobGate.js` allows one at a time for Ambient, Moments, Scene script and stems. Story, Timeline and lyric renders are not gated (lyric has its own cap of 2). A Scene script render took 735 s for a 98.6 s video in the container. | About 100 heavy renders a day at most. One long render slows every page. |
| Deploys | A deploy restarts the process and kills running renders (issue #55). | With users rendering around the clock, every deploy breaks someone's video. |
| Data | JSON files under DATA_DIR. `users.json`, `usage.json`, `plan.json`, `library.json`, `queue.json`, `social.json` and others are written with a plain `writeFileSync` (not atomic). It is safe only because there is one process. | It can't run two processes. A crash mid-write corrupts a file. There are no queries, indexes or backups. |
| Files | Outputs are on the box's disk, served publicly from `/outputs` ("the link is the secret"). `perUserOutputs.js` scans every user's folder on a cache miss. `cleanupMediaFiles` exists but is never called. | The disk fills up. The cache-miss scan grows with the number of users. |
| Uploads | Cloudflare caps a request body at 100 MB. Large uploads go straight to GCS. | Fine; keep the direct-upload path. |
| Restart recovery | `reconcilePersistedJobs` scans only the owner's `render-jobs`, not `users/*`. Seedance clips already ordered are collected after a restart. | Other users' jobs stay "running" for ever. |
| Paid AI | Seedance has one monthly cap ($30 default) shared by everyone. **The Veo endpoint `/api/video-gen/generate` has no quota, ledger or plan check.** Daily quotas are in memory and reset at midnight UTC. | One user can spend the whole month's budget, or an unlimited amount on Veo. |
| Billing | Stripe with a single premium price. No credits or metering. | AI video costs $2 to $10 a video. A flat price can't cover heavy users. |
| Auth | Firebase sign-in, swapped for the app's own 7-day JWT. `JWT_SECRET` falls back to `dev_secret_change_me` if it is not set. The JWT is also accepted as `?token=` in the URL. | A missing secret means forgeable tokens. A token in a URL leaks through logs and the browser history. |
| Publishing | YouTube OAuth is unverified: 6 uploads a day for the whole app. TikTok goes through Zernio, with per-user connect live but untested end to end. | YouTube publishing stops after the 6th upload of the day. |
| Observability | `console.*` and a `debug.log` file. `/api/health` reports uptime, the ffmpeg version and capabilities. No error tracking, metrics or alerts. No backups in code. | Problems are found by users, not by us. |
| Licences | Remotion is free for companies of up to 3 people. | A company licence is needed when Tiwaton grows past 3. |

## 3. Target shape

```
          Cloudflare (CDN + WAF)
                  |
        web/API  (2+ stateless instances)  ---- Postgres (managed, backed up)
                  |                         \--- Redis (queue, rate limits, sessions)
        job queue (BullMQ on Redis)
                  |
   render workers (N, scale on queue depth)  ---- object storage (Cloudflare R2)
   - ffmpeg renders (Story, Ambient, Timeline, lyric, Moments)
   - Remotion renders (Scene script)
   - AI clip polling (Seedance, Veo), TTS fan-out
```

- **The web tier holds no state.** No job runs inside it, and it can be deployed at any time.
- **Workers drain before a deploy.** A worker stops taking new jobs, finishes the one it has, then restarts. A killed job goes back on the queue and resumes, because clips and voices are already stored.
- **One source of truth.** Postgres holds users, plans, credits, projects, jobs, the spend ledger and the library index. R2 holds every file.

## 4. Phases

Each phase ships on its own and leaves the app working. The order is chosen so the riskiest gaps close first.

### Phase 0: close the open risks (days, not weeks)
- Refuse to start in production without a strong `JWT_SECRET`, and stop accepting `?token=` except on the few media routes that need it, which get short-lived signed URLs instead.
- Put Veo behind the same plan check, quota and spend ledger as Seedance, or turn it off.
- Make every plain `writeFileSync` store atomic (temp file plus rename), starting with `users.json`, `plan.json` and `usage.json`.
- Run `cleanupMediaFiles` on a schedule, with a disk alarm.
- Fix `reconcilePersistedJobs` so it covers every user's `render-jobs`.
- Add nightly backups of the DATA_DIR and outputs volumes (Coolify scheduled backup or rsync to R2), and test a restore once.
- Add error tracking (Sentry or similar) with alerts for render failures.

### Phase 1: a job queue and separate workers
- Add Redis and BullMQ. Every heavy job becomes a queued job with an id, owner, kind, inputs, progress and result. Start with Scene script and Story renders, then Ambient, Timeline, lyric and Moments.
- Workers run the same image with `ROLE=worker`. Coolify runs the web and the workers as separate services, both reading the shared volumes until Phase 3.
- Graceful drain on deploy: SIGTERM stops new pulls, waits for the current job (with a time limit), and puts unfinished work back on the queue.
- Per-user concurrency (for example 1 heavy render at a time on free, 2 on premium) and a fair queue, so one user can't block everyone.
- **Done when** a deploy during a render does not lose it, and two workers render in parallel.

### Phase 2: Postgres
- Move users, plans, usage, the spend ledger, jobs and the visual library index first. These need transactions and are read across users. Then move projects (story, scene script, timeline, lyric, ambient, moments) as JSONB rows keyed by owner.
- A one-off migration script reads the JSON files and writes rows. It runs twice with the same result, and keeps the files as a fallback until it is verified.
- Daily quotas and spend checks become atomic database updates instead of in-memory counters.
- **Done when** two web instances can run at once.

### Phase 3: object storage (R2) and a CDN
- Every output, upload, clip, voice and poster goes to R2. Workers download inputs to a scratch disk, render, upload the result and delete the scratch files.
- Serve files from R2 through Cloudflare with signed, expiring URLs instead of the public `/outputs` folder. This retires the cross-user scan in `perUserOutputs.js`.
- Lifecycle rules: delete intermediate files after 14 days and keep final videos per plan.
- **Done when** the box's disk holds only scratch files.

### Phase 4: pay for what you use
- Credits: each plan includes a monthly amount, and top-ups go through Stripe. AI clips, premium voices and long renders spend credits at a known price, shown before the user confirms (as Scene script already shows a clip's cost).
- Per-user spend caps, replacing the single shared Seedance cap. The owner keeps a global ceiling as a safety net.
- Each provider's account limits are raised in step with sign-ups: BytePlus, Azure Speech, OpenAI, ElevenLabs and Gemini.
- **Done when** no paid call happens without a user's credits behind it.

### Phase 5: publishing at volume
- Get the Google OAuth app verified for the YouTube upload scope, which removes the 6-a-day cap. This needs a privacy policy, a demo video and possibly a security assessment, and can take weeks, so start it early.
- Test TikTok per-user connect end to end, and move publishing onto the queue with retries.

### Phase 6: capacity and load testing
- Load-test the queue with a simulated 2,000 renders a day (k6 or a script driving the API) and size the workers from the results.
- Starting estimate: a Scene script render uses about 2 cores for about 12 minutes, so 2,000 a day of mixed renders needs about 8 to 12 worker cores busy at peak. That is 3 to 4 worker machines of the current size, plus 1 for the web tier. Measure before buying.
- Set up autoscaling or a standing pool, plus an alert on queue wait time.

### Phase 7: operations
- Structured logs, a render dashboard (queued, running, failed, average time), uptime checks and on-call alerts.
- A security review before opening sign-ups: rate limits on every write route, upload scanning, abuse reporting and an admin kill switch for a user.
- Licences: Remotion company licence when the team passes 3 people; check the terms of every model provider for commercial use at volume.

## 5. Rough cost at 20,000 users (to be measured, not promised)

- **Hosting:** web plus 3 to 4 render workers, managed Postgres and Redis, and R2. Order of a few hundred US dollars a month, depending on provider.
- **AI:** dominated by video clips ($0.08/s on Seedance Mini 720p) and paid for by users' credits under Phase 4. Free plans should not include AI video.

## 6. Open decisions for the operator

1. **Hosting:** stay on Coolify with more machines, or move workers to a managed container platform?
2. **Plans:** prices, what each plan includes in credits, and what stays free.
3. **Launch markets:** this decides voices, currencies and payment methods (for example Paystack for Nigeria alongside Stripe).
4. **The Google verification application** (Phase 5) needs the operator's details and a demo video.
