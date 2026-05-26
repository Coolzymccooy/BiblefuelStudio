# Auto-Share Options Research — Normie-First

**Date:** 2026-05-26
**Author:** Implementation note for the public-launch roadmap
**Goal:** Inventory every realistic path a non-technical user has to get a rendered video off Biblefuel Studio and onto their social platforms. Used to inform the ShareSheet UX (see [companion spec](2026-05-26-share-sheet-design.md)).

---

## TL;DR (recommendations for Biblefuel)

The Share UX should layer **four tiers**, each chosen at runtime by what the user has connected and what device they're on:

| Tier | Trigger | What happens | Required setup |
|---|---|---|---|
| **1** | "Download" button | Browser saves the MP4 (or MP3 / SRT) locally; user uploads manually wherever they like | None. Always works. |
| **2** | "Share" button (mobile only) | Web Share API opens the OS share sheet → TikTok, Instagram, WhatsApp, Messenger, etc. directly accept the file | HTTPS + mobile browser (Chrome, Safari, Samsung Internet). Free. |
| **3** | "Share to [platform]" per-platform buttons | Calls our Postiz API → either posts (if connected) or returns the platform OAuth URL (if not) → user signs in once → from then on it's one click | Self-hosted Postiz instance (Phase 4 infra) + OAuth apps registered per platform |
| **4** | "Auto-share on render" toggle (Settings) | When a campaign render finishes, server-side auto-posts to all the user's connected platforms via Postiz | Tier 3 already set up + user opts in |

**The killer combo for normies:** Tiers 1 + 2 on mobile mean *every user can share to every app on their phone* without us ever wiring up an OAuth flow. Tier 3 only matters for schedule-from-the-app and for desktop users who don't have native apps installed.

---

## Tier 1 — Download (universal floor)

The user clicks "Download MP4". Browser saves the file. They upload manually wherever they want.

**Pros:** No OAuth, no API limits, no platform audits. Works on every device, every platform, including platforms we don't support (BeReal, Snapchat, Lemon8, RedNote, future apps).
**Cons:** Manual. Two-step (download → open app → upload).
**Cost:** Zero — just a static file route. Biblefuel already serves `/outputs/<filename>` via `express.static`.

**Implementation:** A `<a href="/outputs/foo.mp4" download="biblefuel-yyyy-mm-dd.mp4">` link. Phase-5 nice-to-have: server-side format conversion to TikTok-vertical (1080×1920 9:16), YouTube-landscape (1920×1080), Instagram-square (1080×1080), MP3-only.

---

## Tier 2 — Web Share API (the normie magic trick)

`navigator.share({ files: [mp4File], title, text, url })` on mobile triggers the native OS share sheet — the same one users see when they share from Photos or Files. From there they pick TikTok, Instagram, WhatsApp, Messages, Mail, etc. The OS handles authentication; we don't touch OAuth.

**Browser support (May 2026):** Chrome/Edge on Android, Safari on iOS 14+, Samsung Internet, Firefox Android. **Desktop Linux/Windows/macOS: not supported.** Feature-detect with `if (navigator.share && navigator.canShare({files: [...]}))`.

**Pros for normies:** Zero learning curve. They already know how the share sheet works. Same flow they use for photos.
**Cons:** Mobile-only. Doesn't auto-fill the caption on every target app (TikTok accepts the file but ignores `text:` field, etc. — varies by platform). Requires HTTPS + secure context.
**Cost:** Zero. Pure browser API.

**Implementation sketch:**
```js
async function shareVideo(videoUrl, caption) {
  const blob = await fetch(videoUrl).then(r => r.blob());
  const file = new File([blob], 'biblefuel.mp4', { type: 'video/mp4' });
  if (!navigator.canShare?.({ files: [file] })) {
    // Fallback: copy link to clipboard + toast "Share link copied"
    return false;
  }
  await navigator.share({ files: [file], title: 'Biblefuel video', text: caption });
  return true;
}
```

Source: [MDN — Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API), [web.dev guide](https://web.dev/web-share/).

---

## Tier 3 — Server-side OAuth via Postiz

Once the user clicks "Share to TikTok" and they haven't connected yet, we redirect them to Postiz's hosted OAuth screen. Postiz handles the platform-specific flow (TikTok content posting consent, YouTube scope picker, etc.), stores the refresh token, and gives us a stable connection ID. Subsequent clicks just call `POST /api/postiz/post` server-side.

**Pros:** True one-click reposting after first connect. Works on desktop. Persists schedules. Single OAuth app per platform, reused across all our users.
**Cons:** Each platform needs a registered developer app (TikTok needs audit — days to weeks; Meta/Instagram needs app review — 1–2 weeks; X needs $100/mo Basic tier).
**Cost:** Self-hosted Postiz: server infra only (~$15/mo Hetzner) once apps are registered. Hosted alternatives:
- [Upload-Post](https://www.upload-post.com/): $16/mo flat
- [Blotato](https://www.blotato.com/): $29–499/mo
- [Ayrshare](https://www.ayrshare.com/): $599/mo (multi-user "Business" plan)

**Why Postiz is still the right call for Phase 4:** Cost ceiling. Our free-tier users would burn through Upload-Post's hosted limits fast.

---

## Tier 4 — Auto-share on render

A `Settings → Auto-publish` toggle. When ON, every successful render fires `POST /api/postiz/post` to the user's connected platforms with the campaign's caption. This is what the operator already has with Zernio + Make.com for `@Biblefuel`. Phase 4 replaces that path with Postiz so it's available to all premium users.

**Pros:** True hands-off automation. The user generates 30 days of content, schedules them, walks away.
**Cons:** Failure modes are invisible — if TikTok rejects a post 6 days into a schedule, the user only finds out checking their dashboard. Need clear failure notifications.
**Cost:** Same as Tier 3.

---

## Survey — every other option considered (and why each is wrong for normies)

### Aggregator APIs we could buy

| Tool | Pricing (May 2026) | Why we're not using it |
|---|---|---|
| [Upload-Post](https://www.upload-post.com/) | Free 10 uploads/mo, paid from $16/mo | Hosted alternative if self-hosted Postiz is too heavy. Keep as fallback. |
| [Blotato](https://www.blotato.com/pricing) | $29 Starter → $499 Agency | API may be Agency-only; pricing rules it out as a free-tier backend |
| [Ayrshare](https://www.ayrshare.com/business-plan-for-multiple-users/) | $599/mo for 30 profiles + $8.99/extra | Built for agencies, not free-tier creator apps |
| [Postiz (self-hosted)](https://github.com/gitroomhq/postiz-app) | Free (run it yourself) | **Chosen.** OSS, MIT, OAuth direct, ~$15/mo infra |
| [Mixpost](https://github.com/inovector/mixpost) (self-hosted) | Free OSS (Laravel) | Solid Postiz alternative; less polished API. Worth knowing as a backup. |

### Consumer schedulers (users sign up themselves, we just provide download)

For users who want a polished scheduling UI BEYOND what Biblefuel offers, they can take the downloaded MP4 to:

| Tool | Pricing (May 2026) | Why mention in docs |
|---|---|---|
| [Buffer](https://buffer.com/) | Free for 3 channels, $6/channel/mo paid | "The easiest" per multiple 2026 reviews |
| [Pallyy](https://pallyy.com/) | Free single-user, $25/mo | Visual calendar normies love |
| [SocialBee](https://socialbee.com/) | $24/mo+ | Content-category recycling |
| [Publer](https://publer.io/) | Free 3 accounts, $12/mo+ | Bulk scheduling + analytics |
| [Hootsuite](https://www.hootsuite.com/) | $99/mo+ | Enterprise-feel; overkill for solo creators |
| [Later](https://later.com/) | $25/mo+ | Instagram-first; visual planner |
| [Loomly](https://www.loomly.com/) | $42/mo+ | Brand-asset library focused |
| [ContentStudio](https://contentstudio.io/) | $25/mo+ | AI suggestions baked in |
| [Crowdfire](https://www.crowdfireapp.com/) | Free + paid | Article-based posting; less video-heavy |

**Use case:** "Download → upload to your scheduler of choice." We include a "Where to schedule" tooltip pointing at these. The user picks whatever they already use.

### No-code automation (power users only — not for normies)

- [Make.com](https://www.make.com/) — what the operator (you) currently uses with Zernio for `@Biblefuel`. Powerful but every user would need their own Make account + scenario. ❌ for normies.
- [Zapier](https://zapier.com/) — same shape. ❌
- [n8n](https://n8n.io/) — self-host equivalent. Requires JSON workflow editing. ❌
- [Pabbly Connect](https://www.pabbly.com/connect/) — Zapier alternative. ❌
- [IFTTT](https://ifttt.com/) — simpler than Zapier, fewer triggers. ❌

These exist; document them as "advanced" in Help, not as primary share paths.

### Platform-native intent URLs (link-share fallback)

Mobile apps register URL schemes that open the app to a "share" or "compose" view. Useful for **text + link** sharing (not video upload):

| Platform | URL pattern | Works on |
|---|---|---|
| X (Twitter) | `https://twitter.com/intent/tweet?text=...&url=...` | All devices, opens web or app |
| LinkedIn | `https://www.linkedin.com/sharing/share-offsite/?url=...` | All devices, web |
| Facebook | `https://www.facebook.com/sharer/sharer.php?u=...` | All devices, web |
| WhatsApp | `https://wa.me/?text=...` | Mobile + desktop |
| Reddit | `https://reddit.com/submit?url=...&title=...` | All devices |
| Telegram | `https://t.me/share/url?url=...&text=...` | All devices |
| Email | `mailto:?subject=...&body=...` | All devices |
| Copy link | clipboard API | All devices |
| **TikTok** | **no public intent URL for video upload** | — (use Tier 2/3) |
| **Instagram** | no upload intent (URL schemes exist but only for opening to a stored video, not seeded from web) | — (use Tier 2/3) |
| **YouTube** | no upload intent | — (use Tier 2/3 or download) |

So **intent URLs help us cover text/link sharing** (Twitter, LinkedIn, FB, WhatsApp, Reddit) but **not video uploads to TikTok/IG/YouTube** — those still need Tier 2 (Web Share) or Tier 3 (Postiz OAuth).

Source: [TikTok deeplink docs](https://ads.tiktok.com/help/article/list-of-supported-deeplink-formats), [TikTok content posting API docs](https://developers.tiktok.com/products/content-posting-api/).

---

## Decision matrix — what we ship in Phase 4 vs later

| Feature | Phase 4 (now) | Phase 5+ |
|---|---|---|
| Download MP4 | ✅ direct link | format conversion (vertical/landscape/square) |
| Web Share API | ✅ if `navigator.canShare` | analytics on which target was picked |
| Per-platform "Share to" via Postiz | ✅ TikTok, YouTube, Instagram, X, FB, LinkedIn | Threads, Reddit, Pinterest, Bluesky, Mastodon, Discord |
| Intent-URL share buttons (Twitter, FB, WhatsApp, Reddit, etc. — text+link) | ✅ universal fallback | — |
| Auto-share on render toggle | ✅ super-admin + premium | per-platform exclusion list |
| Copy link to rendered output | ✅ always | shortener (dub.sh / kutt.it) integration |

---

## Edge cases the ShareSheet must handle

- **No token / not signed in** — show "Sign in to share" link to login
- **Free user hits a premium-only platform** — show "Upgrade to share to X" with link to pricing
- **Postiz down (503)** — Tier 1 + 2 + intent URLs still work; Tier 3 buttons disabled with tooltip "Auto-share temporarily unavailable"
- **No connected accounts** — show "Connect your accounts" CTA pointing at Settings
- **Render still in progress** — share UI hidden until job.status === 'done'
- **Output file deleted (cleanup ran)** — show "Re-render to share" message
