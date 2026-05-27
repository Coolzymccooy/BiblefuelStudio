# Merge smoke test — dev branch (2026-05-27)

**Goal:** verify the landing-page + auth-fix work and the multitenancy/share/billing work coexist cleanly on `dev`. ~25 minutes end-to-end.

## 0. Boot the test environment

From this worktree root in **one** PowerShell window:

```powershell
.\start-test.ps1
```

Runs Biblefuel in production-style mode: the Express server serves the prebuilt client bundle from `server/public/` at **http://localhost:5174**. No vite dev server, no proxy, no second terminal. This is the same shape Coolify deploys in production, so what you smoke-test here is what ships.

Open `http://localhost:5174` in **incognito**. The first time you sign up, you get a fresh per-user data dir under `server/data/users/<uid>/`.

### Test env baseline (already set in `server/.env`)

Production-aligned: every gate is at its real production value so you actually exercise the feature, not a dev bypass.

| Key | Value | Why |
|---|---|---|
| `PORT` | `5174` | Single URL: http://localhost:5174 |
| `MULTITENANT` | `true` | Per-user data isolation (required for tests 23/24) |
| `SUPER_ADMIN_EMAIL` | `coolshegz@gmail.com` | YOUR admin email — gets unlimited quotas. **Don't sign up with this email for tests that check free-tier behaviour or multi-tenancy isolation.** |
| `REQUIRE_EMAIL_VERIFIED` | `true` | Email-verification gate is ON. Signup → "check your email" interstitial → click verify link in the Firebase email → gated routes unlock |
| `RESEND_API_KEY` | _empty_ | Email transport runs in stub mode — logs the email body to the server window console instead of delivering. Drop a real Resend key in `server/.env` to switch to live delivery. |
| `ACCESS_REQUEST_NOTIFY_TO` | `coolshegz@gmail.com` | Recipient when Resend goes live |
| `STRIPE_SECRET_KEY` | _unset_ | Billing routes return 503; upgrade buttons hide. Add a `sk_test_…` key + `STRIPE_PREMIUM_PRICE_ID` + `STRIPE_WEBHOOK_SECRET` to exercise checkout |
| `POSTIZ_URL` | _unset_ | Postiz/AutoPublish cards hide (Postiz containers exist but are parked — see `docs/superpowers/plans/2026-05-26-postiz-deployment-status.md`) |

> **Pin your test account.** Use a non-super-admin email (e.g. `test+<timestamp>@gmail.com`) for quota/multitenancy tests. `coolshegz@gmail.com` bypasses every quota and isolation check by design.

### Reset state between full runs

```bash
rm -rf server/data/users/   # wipes ALL per-user data
rm  server/data/access-requests.json  # if it exists
```

Don't delete `server/data/library.json` or `server/data/jobs.json` — those are global.

---

## A. Anonymous landing flow *(landing-page work)*

1. **Landing mounts at `/`**
   - Open `http://localhost:5174/` in incognito
   - ✅ Landing page renders: Header, Hero, KineticVerse, HowItWorks, WhatsInside, Footer
   - ❌ FAIL: dashboard or sign-in form shows instead of landing

2. **CSP / console hygiene on landing**
   - DevTools open while you scroll the landing page
   - ✅ No CSP warnings, no React error-boundary catches, no 404 asset fetches
   - ❌ FAIL: any red errors in console

3. **Auth fence on `/app/*` for unauthed users**
   - Manually type `http://localhost:5174/app/wizard` into the URL bar
   - ✅ Redirected to `/app` sign-in (NOT the wizard page)
   - ❌ FAIL: wizard page renders — **sidebar-bypass regression**

4. **Sidebar locked when unauthed on `/app`**
   - From step 3 (now sitting on `/app` sign-in)
   - ✅ Sidebar shows ONLY: wordmark, locked-prompt copy, Login button. No Wizard/Series/Scripts/Backgrounds links visible.
   - ❌ FAIL: nav links visible while signed-out

5. **Wordmark navigates to landing**
   - Click "BiblefuelStudio" wordmark from the `/app` sign-in screen
   - ✅ Lands on `/` (the landing page)
   - ❌ FAIL: wordmark dead or sends you elsewhere

---

## B. Request-Access form *(landing-page work, public endpoint)*

6. **Access-request submission writes to disk**
   - On landing, fill the Request Access form: name, email, org, pitch
   - Submit → ✅ "Received" / success message shown
   - In another shell: `cat server/data/access-requests.json` → new row appears with the fields you entered
   - ❌ FAIL: 400/500 status, or no row written

7. **Email transport hits stub when Resend not configured**
   - Check the **server window** stdout — should see a `[mail:stub]` line with your submission's fields (since `RESEND_API_KEY` is empty)
   - ✅ Stub log line present
   - ❌ FAIL: server crash, or real email attempt with auth error

8. **Honeypot blocks bots**
   - In DevTools console while landing is loaded:
     ```js
     fetch('/api/access-requests', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name:'bot', email:'b@b.com', org:'x', pitch:'x', hp_url:'http://evil.com'})}).then(r => r.json())
     ```
   - ✅ Response `{ok:true}` BUT `server/data/access-requests.json` did NOT get a new row
   - ❌ FAIL: the bot submission was persisted

9. **Form rate-limit (3/hour)**
   - Submit the form 4 times in a row
   - ✅ 4th submission returns `RATE_LIMITED` (HTTP 429)
   - ❌ FAIL: all 4 accepted

---

## C. Signup + login flow *(both agents — UI meets server)*

10. **Signup creates account and triggers verification email**
    - From landing → Login/Signup → switch to "Signup" → use `test+<timestamp>@gmail.com` + a password → submit
    - ✅ Toast says "check your email" (or equivalent); user is signed in BUT in "unverified" state
    - ✅ A Firebase verification email lands at that address (check inbox; may be in Promotions/Spam)
    - ❌ FAIL: signup throws, or no email is queued

11. **Gated routes blocked before verification**
    - Without clicking the verify link yet, try to generate a script (or any expensive route)
    - ✅ Server returns 403 `EMAIL_NOT_VERIFIED`, UI shows a "verify your email" notice
    - ❌ FAIL: request goes through without the email being verified

12. **Verification unlocks gated routes**
    - Click the verify link in the email → it opens a Firebase page confirming success
    - Back in the app, reload (or click anywhere that re-fetches `/api/auth/status`)
    - ✅ Sidebar nav now includes all routes; generate-script call succeeds
    - ❌ FAIL: still 403 after verification — check server window for `EMAIL_NOT_VERIFIED` and confirm the Firebase token was refreshed

13. **Login rate-limit shows amber-toned friendly 429**
    - Sign out → on login screen, click "Sign in" 6+ times rapidly with a wrong password
    - ✅ Eventually shows amber banner with copy like "Too many attempts in a short window — try again in a minute"
    - ❌ FAIL: raw `429` text, red error styling, or app crash

14. **`/api/auth/status` NOT rate-limited**
    - With DevTools Network tab open, sign in successfully, then run in console:
      ```js
      for (let i=0;i<30;i++) fetch('/api/auth/status').then(r => console.log(i, r.status))
      ```
    - ✅ All 30 return 200
    - ❌ FAIL: any 429 in those — **breaks the auto-status-poll on sign-in**

---

## D. App shell + per-user data *(both — multitenancy meets new shell)*

15. **New user starts with empty data**
    - As the verified user from tests 10-12 (a non-super-admin email), look at Library, Scripts, Jobs, Queue, Series, Settings → Voice Presets
    - ✅ All empty / no items
    - ❌ FAIL: any prior user's content visible — multitenancy is broken

16. **Toast `<Link>` inside body navigates correctly**
    - Go to Voice / Audio page → click the **Use** button on any item in Recent Audio
    - ✅ Toast appears with copy ending in "Open Render →"; clicking "Open Render →" navigates to `/app/render` with the audio path applied — **no white screen**
    - ❌ FAIL: blank screen after clicking the toast link

17. **Service-worker freshness**
    - With DevTools Network tab open, hard-refresh (Ctrl+Shift+R) on any `/app/*` page
    - ✅ `index.html` returns 200 (not 304 from a stale SW); fresh asset hashes load
    - ❌ FAIL: old bundle continues to serve from SW

---

## E. Render + ShareSheet *(my work)*

18. **Render a short video**
    - `/app/render` → pick a Library background → enter 1-2 caption lines → "Start Instant Render"
    - ✅ Video renders, "Render Result" card appears with inline player
    - ❌ FAIL: FFmpeg error, infinite spinner, no result card

19. **ShareSheet inside the render result**
    - In the result card, verify these are present:
      - [ ] Download MP4 button
      - [ ] Copy link button
      - [ ] "Share…" button (mobile / Chrome with Web Share — may be absent on Windows desktop, that's OK)
      - [ ] Twitter / WhatsApp / Facebook / Reddit / Email intent buttons
      - [ ] NO "Auto-publish to your accounts" section (Postiz unconfigured)
    - Click Download → file saves
    - Click Copy link → paste somewhere → confirm URL
    - ❌ FAIL: missing buttons, download 404s, clipboard empty, or Postiz section appears

20. **Share button on completed background jobs**
    - `/app/jobs` → find a "done" render → click the green **Share** button
    - ✅ ShareSheet opens in a modal with the same options as test 19
    - ❌ FAIL: modal doesn't open, or video URL is wrong

---

## F. Settings *(my work)*

21. **Plan and Usage card visible**
    - `/app/settings` → top of page
    - ✅ Card shows your plan (`free` for non-admin email) and 4 progress bars (scripts/tts/render/imageGen)
    - ❌ FAIL: card missing, or wrong plan tier

22. **Postiz + AutoPublish cards hidden**
    - Same settings page
    - ✅ No "Connect social accounts" or "Auto-publish on render" sections rendered
    - ❌ FAIL: broken/empty cards visible

23. **Quota enforcement (free-tier)**
    - Free-tier render limit = 3/day. As your non-admin test user, queue 4 short renders (durationSec=20)
    - ✅ 4th attempt returns 429 `QUOTA_EXCEEDED`, UI shows an upgrade message
    - ❌ FAIL: all 4 render with no quota check (would only happen if user is super-admin — confirm with test 15 user)

---

## G. Multi-tenancy isolation *(my work — CRITICAL)*

24. **Two users, two universes (expanded)** *(SHIP BLOCKER)*
    - Sign out of user 1 → open incognito window 2 → sign up as `test2+<timestamp>@gmail.com` → verify email so they're fully active
    - As user 2, check **all** of these pages:
      - [ ] Library — empty
      - [ ] Scripts — empty
      - [ ] Jobs — empty
      - [ ] Queue — empty
      - [ ] Backgrounds (uploads) — empty
      - [ ] Settings → Voice Presets — only defaults, no user-1 customisations
      - [ ] Render → "Video to Share" dropdown — no user-1 outputs
    - ✅ All seven empty/clean
    - ❌ FAIL on ANY of them: **DO NOT SHIP** until fixed

25. **Cross-user file URL is gated** *(SHIP BLOCKER)*
    - As user 2, copy a video URL you saw user 1 generate (e.g. `/outputs/video-<uuid>.mp4` where the uuid was from user 1's render)
    - Paste into a new tab while signed in as user 2
    - ✅ 403 or 404 — file is not served
    - ❌ FAIL: file downloads — **DO NOT SHIP**

---

## H. Account self-delete *(my work)*

26. **User can delete their own account end-to-end**
    - As user 2 → Settings → "Danger zone" / Delete account → confirm
    - ✅ Redirected to landing page (`/`), toast confirms deletion
    - In server shell: `ls server/data/users/<user2-uid>/` → no longer exists
    - Try to re-sign-in with `test2+<timestamp>@gmail.com` and the same password
    - ✅ Sign-in fails ("user not found") OR creates a brand-new empty account (NOT user 2's old data)
    - ❌ FAIL: old data dir rehydrates after re-login — Firebase user wasn't deleted

---

## Run log

Record results here so the next pass picks up cleanly. Add a new section per run.

### Run 1 — 2026-05-27, tester: _________

| # | Result | Notes |
|---|---|---|
| 1 |  |  |
| 2 |  |  |
| 3 |  |  |
| 4 |  |  |
| 5 |  |  |
| 6 |  |  |
| 7 |  |  |
| 8 |  |  |
| 9 |  |  |
| 10 |  |  |
| 11 |  |  |
| 12 |  |  |
| 13 |  |  |
| 14 |  |  |
| 15 |  |  |
| 16 |  |  |
| 17 |  |  |
| 18 |  |  |
| 19 |  |  |
| 20 |  |  |
| 21 |  |  |
| 22 |  |  |
| 23 |  |  |
| 24 |  |  |
| 25 |  |  |
| 26 |  |  |

Mark **PASS** / **FAIL** / **SKIP** with a one-line reason for any FAIL or SKIP. Screenshot or curl-output is welcome for FAILs.

---

## What "ship-ready" means

- All A-H pass → safe to fast-forward `master` to `dev` and deploy
- Test **24** or **25** fail → **HOLD — multitenancy isolation is non-negotiable**
- Anything else → file bug, fix on `dev`, re-run failing section only

## Notes for Coolify side

Production (`master`) hasn't been touched today. When you're ready to deploy:

```bash
git checkout master
git merge dev --ff-only
git push origin master
```

Coolify auto-redeploys from `origin/master` (per the existing config). The Postiz sidecar at `https://postiz.tiwaton.co.uk` stays parked — it's gracefully hidden as long as `POSTIZ_URL` is unset in the production env (see `docs/superpowers/plans/2026-05-26-postiz-deployment-status.md`).
