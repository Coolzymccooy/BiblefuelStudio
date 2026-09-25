# Story Video — Talking / Animated Video — BACKLOG (deferred)

**Status:** NOT STARTED — design notes + vendor research captured for later pickup.
**Sub-project:** 4 of 4 in the Story Video enhancement program (History ✅ → Trim ✅ → Script entry ✅ → **Talking/animated video** ⬜).
**Date captured:** 2026-06-08

## What this is

Upgrade Story Video so scenes can be **animated AI video** (each scene image turned into a short moving clip), or a **talking-avatar** narrator — instead of still images with Ken Burns motion. This is a **paid external API** capability, so it ships **gated** and **cost-capped**.

## Decisions already made (with the user)

- **Gated, admin-controlled.** The super-admin (operator) always has it. Every other user is **locked** until the admin flips a per-user toggle in the Admin UI. No whole-tier unlock — per-user grants only.
- **Free-tier-first + cheapest-overage vendor.** Prefer a vendor with a genuine free daily/monthly quota, then cheap pay-as-you-go.
- **30-minute videos are out of scope.** AI video is priced per second/minute; long videos are economically absurd. Cap clip/scene length short.

## RECOMMENDED VENDOR (pick to confirm later)

**fal.ai (aggregator), image-to-video.**
- One REST API key; pure pay-as-you-go (~**$0.02–0.10 / sec**); small signup credit.
- Hosts Kling / MiniMax-Hailuo / Luma / Wan — **swap the underlying model without re-coding**, and **cap spend** centrally.
- Fits Story Video: animate each existing scene image into a ~5s clip; keep the existing voiceover + captions + render pipeline.

Backup single-vendor options: **MiniMax/Hailuo** (cheapest per-sec, free daily tier) or **Luma Dream Machine** (direct API, free credits — but free output is watermarked + non-commercial).

## Vendor research summary (approximate, 2026 — from cited pricing pages)

### Image-to-video (the fit for Story Video)
| Vendor | API | Free tier | After free (approx) | Notes |
|---|---|---|---|---|
| **fal.ai / Replicate** (aggregators) | REST | small signup credit | **~$0.02–0.10/sec** | hosts Kling/MiniMax/Luma/Wan; easiest cap + model swap. **TOP PICK** |
| **MiniMax / Hailuo** | via aggregator | free **daily** credits (watermark) | ~$0.01–0.05/sec (~$0.05–0.15/5s) | cheapest per-sec; ~$9.99/mo=1000 cr |
| **Haiper** | direct REST | trial credits | $0.033/s (540p), $0.05/s (720p) | cheapest *documented direct* API; ~$8/mo |
| **Luma Dream Machine** | direct REST | free daily-reset credits; 5s, 720p, watermark, **no commercial on free** | ~$0.02–0.05/sec | commercial only on Plus $29.99/mo+ |
| **Kling** | via aggregators | **66 free credits/day** (expire 24h) | ~$0.12/clip; ~$0.126/sec (v3) | strong quality; no rollover |
| **Stability (SVD)** | REST | $5–25 trial credits | ~$0.01/credit ($20/mo=6000) | lower quality |
| **Runway Gen-4** | ⚠️ **Enterprise-only API (Jan 2026)** | web-only 125 cr, watermark | $0.25–0.60/5s clip | **AVOID v1** — no practical free API, pricey |

### Talking-avatar / lip-sync (different format — defer to a later premium tier)
| Vendor | Free API? | Price | Notes |
|---|---|---|---|
| **Tavus** | ✅ free dev tier (25 min convo + 5 min gen) | PAYG after | only one with a real free developer API; conversational focus |
| **D-ID** | ❌ 14-day trial (20 cr) | ~$0.50–$2/min; API on Pro ~$18–48/mo | easiest dev integration |
| **HeyGen** | ❌ **removed free API (Feb 2026)** | ~$1/min std, $4/min premium; $5 min | free *web* tier = 3 vids/mo personal-use only |
| **Synthesia** | ❌ | API on Creator $89/mo+ | no free API |

Sources gathered (deep-research run, 2026): flowith.io (Luma 2026), docs.dev.runwayml.com, docs.haiper.ai, Stability pricing, help.heygen.com / docs.heygen.com, eesel.ai, lumalabs.ai, MiniMax 2026 pricing, D-ID review pages. Figures approximate; re-confirm live prices before building.

## Open decisions to make before building

1. **Confirm vendor** (recommended: fal.ai) and the underlying model (Kling vs MiniMax vs Luma).
2. **Length cap** — e.g. 5s per scene; total generated video ≤ ~30–60s.
3. **Per-user monthly cap** — credits or $ ceiling per granted user (bounds total spend).
4. **Where in the flow** — a per-project toggle "Animate scenes (beta)" that, after images are generated, sends each scene image to image-to-video and uses the clips as the render backgrounds instead of stills.

## Implementation sketch (when picked up)

**Gating (infra already exists):**
- Add capability `video.talking` to `server/src/middleware/featureGate.js`, but make the check **super-admin OR a per-user grant** (store grant in the per-user plan record via `userPlanStore` / `getPlanForUser`).
- Admin UI: `GET /api/admin/users` already lists users in `AdminPage`; add a per-user **on/off toggle** → `POST /api/admin/users/:id/grant` + `/revoke` for `video.talking`.
- Gate the new animate endpoint + hide the UI control unless the user has the capability.

**Animation step (new):**
- `server/src/lib/story/animate.js` — `animateImage({ imagePath, ... })` → calls fal.ai image-to-video → returns a short mp4 clip path (in the user's output dir). Provider behind a seam (mockable), with a hard per-call + per-user cost guard.
- `POST /api/story/projects/:id/animate` — animate each `done` scene image into a clip; store `scene.clipPath`. Idempotent (skip already-animated), free-tier-first, stop at the per-user cap with a clear message.
- `storyRender` already takes per-scene segments — feed the animated clips as the scene backgrounds instead of the still images (the timed-segment builder is mostly reusable; verify clip vs still handling).

**Cost controls:**
- Per-user credit ledger (count generated seconds), checked before each call; admin can set the ceiling.
- Free-tier-first: prefer the free quota; only consume paid credits after, and surface remaining budget in the UI.

## Reuse

Everything downstream of "scene images" is built: voiceover (Edge TTS / upload), trim, transcribe, segment, captions, render, history. This sub-project only adds the **animate** step + the **gate** — the render swaps stills for clips.
