import { test } from "node:test";
import assert from "node:assert/strict";
import { createAlerter, alertEmailsEnabled } from "./alerts.js";
import { renderEmailRequest } from "../../../services/email/send.js";

const quiet = { error() {}, warn() {} };

function rig(overrides = {}) {
  const sent = [];
  const captured = [];
  let t = 1_000_000;
  const alerter = createAlerter({
    sendEmail: async (req) => { sent.push(req); return { ok: true }; },
    to: "owner@example.com",
    captureMessage: (msg, extra) => captured.push({ msg, extra }),
    now: () => t,
    log: quiet,
    ...overrides,
  });
  return { alerter, sent, captured, advance: (ms) => { t += ms; } };
}

test("an alert is emailed to the operator and sent to error tracking", async () => {
  const { alerter, sent, captured } = rig();
  const r = await alerter("render-failed", "A story render failed", "ffmpeg exited 1");
  assert.equal(r.emailed, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "ops-alert");
  assert.equal(sent[0].to, "owner@example.com");
  assert.match(sent[0].detail, /ffmpeg exited 1/);
  assert.equal(captured[0].msg, "render-failed: A story render failed");
});

test("one kind emails at most once an hour, then says how many were held back", async () => {
  const { alerter, sent, advance } = rig();
  await alerter("render-failed", "first");
  assert.equal((await alerter("render-failed", "second")).reason, "throttled");
  await alerter("render-failed", "third");
  assert.equal((await alerter("disk-low", "other kind")).emailed, true, "another kind is not held back");
  advance(60 * 60 * 1000);
  await alerter("render-failed", "fourth");
  const renderMails = sent.filter((m) => m.subject !== "other kind");
  assert.deepEqual(renderMails.map((m) => m.subject), ["first", "fourth"]);
  assert.match(renderMails[1].detail, /2 more "render-failed" alert\(s\)/);
});

test("with no email set up it still logs and tracks, and a failed send never throws", async () => {
  const logged = [];
  const { alerter, captured } = rig({ sendEmail: null, log: { error: (m) => logged.push(m), warn() {} } });
  assert.equal((await alerter("backup-failed", "Backup did not run")).emailed, false);
  assert.match(logged[0], /^\[ALERT\] backup-failed: Backup did not run/);
  assert.equal(captured.length, 1);

  const broken = rig({ sendEmail: async () => { throw new Error("SMTP down"); }, captureMessage: () => { throw new Error("tracker down"); } });
  assert.equal((await broken.alerter("x", "y")).reason, "send-failed");
});

test("the alert email escapes its text and keeps the subject on one line", () => {
  const out = renderEmailRequest({ kind: "ops-alert", to: "o@example.com", subject: "Disk\r\nBcc: evil@example.com", detail: "<b>12%</b> free" });
  assert.equal(out.to, "o@example.com");
  assert.doesNotMatch(out.subject, /[\r\n]/);
  assert.match(out.html, /&lt;b&gt;12%&lt;\/b&gt; free/);
});

test("a full disk is a standing condition, so it emails at most twice a day", async () => {
  const { alerter, sent, advance } = rig();
  await alerter("disk-low", "Disk nearly full");
  advance(60 * 60 * 1000);
  assert.equal((await alerter("disk-low", "Disk nearly full")).reason, "throttled", "an hour later is still held back");
  advance(11 * 60 * 60 * 1000);
  assert.equal((await alerter("disk-low", "Disk nearly full")).emailed, true);
  assert.equal(sent.length, 2);
  assert.match(sent[1].detail, /1 more "disk-low" alert\(s\)/);
});

test("alert emails are for production; a dev machine only logs them unless ALERT_EMAILS is on", () => {
  assert.equal(alertEmailsEnabled({ NODE_ENV: "production" }), true);
  assert.equal(alertEmailsEnabled({}), false);
  assert.equal(alertEmailsEnabled({ NODE_ENV: "development" }), false);
  assert.equal(alertEmailsEnabled({ ALERT_EMAILS: "on" }), true);
  assert.equal(alertEmailsEnabled({ NODE_ENV: "production", ALERT_EMAILS: "off" }), false);
});
