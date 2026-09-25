import { Router } from "express";
import { getUsersStore } from "../auth.js";
import { dataDirFor } from "../lib/paths.js";
import { readUsage, resetUsage } from "../lib/usageStore.js";
import { readUserPlan } from "../lib/userPlanStore.js";
import { isSuperAdmin } from "../lib/userPlan.js";
import { getIssuesStore } from "../lib/issuesStore.js";

/**
 * Factory: returns the admin router.
 *
 * @param {{
 *   accessRequestsStore?: import("../lib/accessRequestsStore.js").AccessRequestsStore,
 *   sendEmail?: (req: { kind: string, to: string, [k: string]: any }) => Promise<{ ok: boolean, error?: string }>,
 *   signupUrl?: string,
 * }} deps  Shared dependencies — same store + transport as the public
 *         routers, so approve/deny writes to the SAME file and emails come
 *         from the SAME Resend transport.
 */
export function createAdminRouter({ accessRequestsStore, sendEmail, signupUrl } = {}) {
const router = Router();

/**
 * GET /api/admin/users
 *
 * Return every user in users.json plus their current daily usage + plan.
 * Super-admin's own row is included for completeness, but it reads usage out
 * of the legacy DATA_DIR (same convention withUserScope uses) rather than a
 * per-user dir that doesn't exist for them.
 */
router.get("/users", (req, res) => {
  try {
    const store = getUsersStore();
    const rows = (store.users || []).map((u) => {
      const userish = { sub: u.id, email: u.email };
      let dataDir;
      try { dataDir = dataDirFor(userish); } catch { dataDir = null; }
      const usage = dataDir ? readUsage(dataDir) : { day: null, counts: { scripts: 0, tts: 0, render: 0, imageGen: 0 } };
      const plan = dataDir ? (readUserPlan(dataDir)?.plan || "free") : "free";
      return {
        id: u.id,
        email: u.email,
        role: u.role || "user",
        provider: u.provider || "local",
        emailVerified: Boolean(u.emailVerified),
        createdAt: u.createdAt || null,
        isSuperAdmin: isSuperAdmin(userish),
        plan,
        usage,
      };
    });
    res.json({ ok: true, users: rows });
  } catch (e) {
    console.error("[ADMIN] list users failed:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * POST /api/admin/users/:userId/reset-quotas
 *
 * Zero out today's scripts/tts/render/imageGen counters for the target user.
 * Lets the operator unblock a user mid-day without waiting for midnight UTC.
 */
router.post("/users/:userId/reset-quotas", (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    if (!userId) return res.status(400).json({ ok: false, error: "userId required" });

    const store = getUsersStore();
    const target = (store.users || []).find((u) => String(u.id) === userId);
    if (!target) return res.status(404).json({ ok: false, error: "user not found" });

    const dataDir = dataDirFor({ sub: target.id, email: target.email });
    const fresh = resetUsage(dataDir);
    console.log(`[ADMIN] super-admin ${req.ctx?.email} reset quotas for ${target.email}`);
    res.json({ ok: true, user: { id: target.id, email: target.email }, usage: fresh });
  } catch (e) {
    console.error("[ADMIN] reset quotas failed:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * GET /api/admin/access-requests[?status=pending|approved|denied]
 *
 * Returns every landing-page access request, newest first. Optional `status`
 * query filters server-side so the UI can lazy-render a single tab.
 */
router.get("/access-requests", async (req, res) => {
  if (!accessRequestsStore) {
    return res.status(500).json({ ok: false, error: "access-requests store not wired" });
  }
  try {
    const filter = String(req.query?.status || "").trim().toLowerCase();
    const all = await accessRequestsStore.list();
    const sorted = all
      .slice()
      .sort((a, b) => (Date.parse(b?.createdAt || "") || 0) - (Date.parse(a?.createdAt || "") || 0));
    const rows = filter ? sorted.filter((r) => r.status === filter) : sorted;
    const counts = sorted.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      },
      { pending: 0, approved: 0, denied: 0 },
    );
    res.json({ ok: true, requests: rows, counts });
  } catch (e) {
    console.error("[ADMIN] list access-requests failed:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * POST /api/admin/access-requests/:id/approve
 * POST /api/admin/access-requests/:id/deny
 *
 * Mark a request approved/denied and stamp who reviewed it + when. Approved
 * emails become eligible to sign up (slice 3 gates on that).
 */
async function applyStatus(req, res, status) {
  if (!accessRequestsStore) {
    return res.status(500).json({ ok: false, error: "access-requests store not wired" });
  }
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "request id required" });
    const updated = await accessRequestsStore.setStatus(id, status, {
      email: req.ctx?.email || "",
      userId: req.ctx?.userId || "",
    });
    console.log(`[ADMIN] ${req.ctx?.email} ${status} access-request ${id} (${updated.email})`);

    // Fire-and-forget approval/denial email so the requester knows the
    // decision without us having to check inbox manually. Failures don't
    // block the API response — the admin's UI confirmation is the source
    // of truth; email is a courtesy.
    if (sendEmail && updated.email) {
      const kind = status === "approved" ? "access-approved" : status === "denied" ? "access-denied" : null;
      if (kind) {
        const payload = kind === "access-approved"
          ? { kind, to: updated.email, name: updated.name || "", email: updated.email, signupUrl }
          : { kind, to: updated.email, name: updated.name || "", email: updated.email };
        sendEmail(payload).then((result) => {
          if (!result?.ok) {
            console.warn(`[ADMIN] ${kind} email failed for ${updated.email}:`, result?.error);
          } else {
            console.log(`[ADMIN] ${kind} email sent to ${updated.email}`);
          }
        });
      }
    }

    res.json({ ok: true, request: updated });
  } catch (e) {
    const msg = String(e?.message || e);
    const status404 = /not found/i.test(msg);
    console.error(`[ADMIN] set status ${status} failed:`, msg);
    res.status(status404 ? 404 : 500).json({ ok: false, error: msg });
  }
}

router.post("/access-requests/:id/approve", (req, res) => applyStatus(req, res, "approved"));
router.post("/access-requests/:id/deny", (req, res) => applyStatus(req, res, "denied"));

/**
 * GET /api/admin/issues[?status=open|resolved]
 *
 * List every user-submitted issue, newest first. Status filter optional.
 */
router.get("/issues", async (req, res) => {
  try {
    const filter = String(req.query?.status || "").trim().toLowerCase();
    const all = await getIssuesStore().list();
    const sorted = all
      .slice()
      .sort((a, b) => (Date.parse(b?.createdAt || "") || 0) - (Date.parse(a?.createdAt || "") || 0));
    const rows = filter ? sorted.filter((r) => r.status === filter) : sorted;
    const counts = sorted.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      },
      { open: 0, resolved: 0 },
    );
    res.json({ ok: true, issues: rows, counts });
  } catch (e) {
    console.error("[ADMIN] list issues failed:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/issues/:id/resolve", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "issue id required" });
    const note = typeof req.body?.note === "string" ? req.body.note : "";
    const updated = await getIssuesStore().setStatus(id, "resolved", {
      email: req.ctx?.email || "",
      userId: req.ctx?.userId || "",
      note,
    });
    console.log(`[ADMIN] ${req.ctx?.email} resolved issue ${id}`);
    res.json({ ok: true, issue: updated });
  } catch (e) {
    const msg = String(e?.message || e);
    const code = /not found/i.test(msg) ? 404 : 500;
    res.status(code).json({ ok: false, error: msg });
  }
});

router.post("/issues/:id/reopen", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "issue id required" });
    const updated = await getIssuesStore().setStatus(id, "open", {
      email: req.ctx?.email || "",
      userId: req.ctx?.userId || "",
    });
    console.log(`[ADMIN] ${req.ctx?.email} reopened issue ${id}`);
    res.json({ ok: true, issue: updated });
  } catch (e) {
    const msg = String(e?.message || e);
    const code = /not found/i.test(msg) ? 404 : 500;
    res.status(code).json({ ok: false, error: msg });
  }
});

  return router;
}
