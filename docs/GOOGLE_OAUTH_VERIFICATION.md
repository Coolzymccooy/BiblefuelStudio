# Google OAuth verification — YouTube publishing

BibleFuel's Google Cloud project ("BibleFuel", OAuth client "Biblefuel Studio")
is **In production but unverified**. That costs three things:

| Limit | Cause | Removed by |
|---|---|---|
| "Google hasn't verified this app" screen on Connect | Sensitive scopes, unverified | **OAuth verification** (this doc, part A) |
| 100 users, lifetime, can't be reset | Sensitive scopes, unverified | **OAuth verification** (part A) |
| ~6 uploads a day across all users | Default 10,000-unit quota; `videos.insert` costs 1,600 | **YouTube API quota extension** (part B) — a separate form |

Verification does **not** raise the upload quota. They are two submissions.

---

## Part A — OAuth app verification

### 1. Prerequisites (check before submitting)

- [ ] **Homepage** `https://biblefuel.tiwaton.co.uk` loads without sign-in, describes the app, and links Privacy and Terms (footer). ✅ live
- [ ] **Privacy policy** `https://biblefuel.tiwaton.co.uk/privacy` has the *YouTube and Google data* section and the Limited Use statement. (Added 2026-09-24 — must be deployed before submitting.)
- [ ] **Terms of service** `https://biblefuel.tiwaton.co.uk/terms`. ✅ live
- [ ] **Domain ownership:** `tiwaton.co.uk` verified in [Google Search Console](https://search.google.com/search-console) *with the same Google account that owns the Cloud project*, and listed under **Branding → Authorized domains**.
- [ ] **Branding:** app name "Biblefuel Studio", support email, developer contact email, logo (120×120 PNG). A logo triggers brand review; if you want the fastest path, submit without one.
- [ ] **Redirect URI** `https://biblefuel.tiwaton.co.uk/api/social/youtube/callback` registered on the OAuth client.

### 2. Scopes and justifications (paste into Data Access)

**`https://www.googleapis.com/auth/youtube.upload`**

> Biblefuel Studio creates scripture videos for the signed-in user. When the user
> presses "Publish to YouTube" on a finished video, the app uploads that video to
> the user's own channel with the title, description, tags, privacy setting and
> thumbnail the user entered on that screen. Uploads happen only on that explicit
> action, never automatically, and default to Private.

**`https://www.googleapis.com/auth/youtube.readonly`**

> Used only to call channels.list (mine=true) once, when the user connects, to
> read their channel's name and ID. The app shows "Connected to <channel name>"
> in Settings so the user can confirm which channel their videos will be
> published to before they publish. No other YouTube data (videos, comments,
> subscribers, analytics) is read.

If the reviewer pushes back on `youtube.readonly`, the fallback is to drop it and
show "Connected" without the channel name (the `channels.list` call in
`server/src/routes/social.js` is already non-fatal).

### 3. Demo video (unlisted YouTube link in the form)

Google rejects videos that don't show the consent screen **and** each scope in use.
Record a screen capture, English, 2–4 minutes:

1. Open `https://biblefuel.tiwaton.co.uk`, sign in.
2. Settings → Connections → **Connect YouTube**.
3. On Google's consent screen, **pause and show the browser address bar** — the
   `client_id=` in the URL must be readable. Show the app name and both scopes.
4. Approve. Show Settings reading **"Connected to <channel>"** — this is the
   `youtube.readonly` use.
5. Open a finished video (Ambient → Your sessions → Watch · Publish), fill the
   title, leave privacy **Private**, press **Publish to YouTube**. Show the success
   message, then the video in YouTube Studio → Content — this is `youtube.upload`.
6. Back in Settings, press **Disconnect**, then show
   `myaccount.google.com/permissions` no longer listing Biblefuel.

### 4. Submit

Google Auth Platform → **Verification Center** → *Prepare for verification* →
confirm each page → submit. Replies come to the developer contact email; typical
turnaround is a few days to a few weeks. Answer follow-up emails from the same
thread.

---

## Part B — YouTube API quota extension (the 6-a-day limit)

Separate from Part A. Form: **YouTube API Services — Audit and Quota Extension**
(linked from Google Cloud → APIs & Services → YouTube Data API v3 → Quotas).

Have ready: the same homepage/privacy/terms URLs, the demo video, the expected
daily uploads (be realistic — e.g. 10 users × 2 videos = 20 uploads ≈ 32,000
units/day), and confirmation that uploads are user-initiated only. The audit
checks compliance with the YouTube API Services Terms (the Terms page already
binds users to YouTube's terms and links Google's privacy policy).
