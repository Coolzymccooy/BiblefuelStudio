import { Router } from "express";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getIssuesStore } from "../lib/issuesStore.js";

const router = Router();

// Whitelisted attachment MIME types — keep tight so a malformed upload can't
// land an executable next to user data. Browsers can render all of these
// directly in an <img> tag.
const ALLOWED_ATTACHMENT_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB per file
const MAX_ATTACHMENTS_PER_ISSUE = 3;

const attachmentInputSchema = z.object({
  originalName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(80),
  dataBase64: z.string().min(1),
});

const submitSchema = z.object({
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(3).max(4000),
  severity: z.enum(["low", "medium", "high"]).optional(),
  contextPath: z.string().trim().max(500).optional(),
  attachments: z.array(attachmentInputSchema).max(MAX_ATTACHMENTS_PER_ISSUE).optional(),
});

const replySchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

/**
 * Decode + persist a single base64-encoded attachment to the reporter's
 * issue-attachments dir, returning the metadata to store on the issue record.
 *
 * Throws on validation failure — caller is expected to translate to a 400.
 *
 * @param {{ originalName: string, mimeType: string, dataBase64: string }} input
 * @param {string} dataDir   The reporter's per-user data dir from req.ctx.
 * @param {string} reporterId
 * @returns {Promise<{ filename: string, originalName: string, mimeType: string,
 *   size: number, uploadedAt: string, reporterId: string }>}
 */
async function persistAttachment(input, dataDir, reporterId) {
  const ext = ALLOWED_ATTACHMENT_TYPES.get(input.mimeType.toLowerCase());
  if (!ext) {
    throw new Error(`unsupported attachment type: ${input.mimeType}`);
  }
  // base64 strings are 4 chars per 3 bytes. Tight upper bound BEFORE decode
  // so a malicious client can't force us to decode a huge string.
  if (input.dataBase64.length > Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 64) {
    throw new Error("attachment exceeds 5MB");
  }
  const buf = Buffer.from(input.dataBase64, "base64");
  if (buf.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error("attachment exceeds 5MB");
  }
  if (buf.byteLength < 8) {
    throw new Error("attachment empty or truncated");
  }

  const attachmentsDir = path.join(dataDir, "issue-attachments");
  if (!fs.existsSync(attachmentsDir)) fs.mkdirSync(attachmentsDir, { recursive: true });

  const id = crypto.randomUUID();
  const filename = `${id}.${ext}`;
  await fs.promises.writeFile(path.join(attachmentsDir, filename), buf);

  return {
    filename,
    originalName: input.originalName.slice(0, 200),
    mimeType: input.mimeType.toLowerCase(),
    size: buf.byteLength,
    uploadedAt: new Date().toISOString(),
    reporterId,
  };
}

/**
 * POST /api/issues
 *
 * Any authenticated user can file an issue. Reporter identity is taken from
 * req.ctx (set by withUserScope) — never trusted from the body. Returns the
 * new record so the UI can show "Reported #abc1234" without a follow-up GET.
 */
router.post("/", async (req, res) => {
  try {
    const parsed = submitSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    const data = parsed.data;

    // Save attachments to the reporter's per-user dir BEFORE we persist the
    // issue record. If any attachment fails validation we 400 and never
    // commit the issue — avoids zombie issues that reference missing files.
    let attachments = [];
    if (data.attachments?.length) {
      try {
        attachments = await Promise.all(
          data.attachments.map((a) =>
            persistAttachment(a, req.ctx?.dataDir || "", req.ctx?.userId || ""),
          ),
        );
      } catch (err) {
        return res.status(400).json({ ok: false, error: "ATTACHMENT", details: String(err?.message || err) });
      }
    }

    const store = getIssuesStore();
    const record = await store.append({
      reporterEmail: req.ctx?.email || "",
      reporterId: req.ctx?.userId || "",
      title: data.title,
      body: data.body,
      severity: data.severity || "medium",
      contextPath: data.contextPath || "",
      attachments,
    });
    console.log(`[ISSUES] new ${record.severity} from ${record.reporterEmail}: ${record.title}${attachments.length ? ` (${attachments.length} attachment${attachments.length === 1 ? "" : "s"})` : ""}`);
    res.json({ ok: true, issue: { id: record.id, status: record.status, createdAt: record.createdAt } });
  } catch (e) {
    console.error("[ISSUES] submit failed:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * GET /api/issues/mine
 *
 * Return the authed user's own issues (with admin replies inline) so the
 * Report Issue widget can show a "My Issues" view. We scope by reporterId
 * from req.ctx — never trust a query param for ownership.
 */
router.get("/mine", async (req, res) => {
  try {
    const reporterId = req.ctx?.userId || "";
    if (!reporterId) return res.status(401).json({ ok: false, error: "unauthenticated" });
    const issues = await getIssuesStore().listByReporter(reporterId);
    // Newest first so latest activity is what the user sees on open.
    issues.sort((a, b) => (Date.parse(b?.createdAt || "") || 0) - (Date.parse(a?.createdAt || "") || 0));
    res.json({ ok: true, issues });
  } catch (e) {
    console.error("[ISSUES] list mine failed:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * POST /api/issues/:id/reply
 *
 * Reporter posts a follow-up reply on their own issue. Super-admin can reply
 * on ANY issue (and the reply gets isAdmin=true). Non-owners who aren't
 * super-admin get 403 so users can't probe other reporters' threads.
 */
router.post("/:id/reply", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "issue id required" });

    const parsed = replySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }

    const store = getIssuesStore();
    const issue = await store.findById(id);
    if (!issue) return res.status(404).json({ ok: false, error: "issue not found" });

    const isAdmin = Boolean(req.ctx?.isSuperAdmin);
    const isOwner = req.ctx?.userId && req.ctx.userId === issue.reporterId;
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ ok: false, error: "not your issue" });
    }

    const { issue: updated, reply } = await store.appendReply(id, {
      body: parsed.data.body,
      byEmail: req.ctx?.email || "",
      byUserId: req.ctx?.userId || "",
      isAdmin,
    });
    console.log(`[ISSUES] reply on ${id} by ${req.ctx?.email}${isAdmin ? " (admin)" : ""}`);
    res.json({ ok: true, issue: updated, reply });
  } catch (e) {
    console.error("[ISSUES] reply failed:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * GET /api/issues/attachments/:filename
 *
 * Serve an attachment file inline. Ownership rules:
 *   - The reporter that uploaded it can fetch it from their own dir.
 *   - Super-admin can fetch ANY user's attachment for triage.
 *   - Anyone else gets 404 (deliberately not 403 — we don't want to confirm
 *     filename existence to other users).
 *
 * The filename is the random UUID-based name produced by persistAttachment;
 * we reject anything containing a slash or `..` so a request cannot escape
 * the issue-attachments dir.
 */
router.get("/attachments/:filename", async (req, res) => {
  try {
    const name = String(req.params.filename || "").trim();
    if (!name || name.includes("/") || name.includes("\\") || name.includes("..") || name.length > 80) {
      return res.status(404).json({ ok: false, error: "not found" });
    }
    const ext = path.extname(name).slice(1).toLowerCase();
    const mime = [...ALLOWED_ATTACHMENT_TYPES.entries()].find(([, e]) => e === ext)?.[0];
    if (!mime) {
      return res.status(404).json({ ok: false, error: "not found" });
    }

    const isAdmin = Boolean(req.ctx?.isSuperAdmin);
    const ownerDir = req.ctx?.dataDir || "";
    const tryPath = path.join(ownerDir, "issue-attachments", name);

    if (fs.existsSync(tryPath)) {
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "private, max-age=0, no-store");
      return fs.createReadStream(tryPath).pipe(res);
    }

    // Owner check missed. Super-admin can still find it by scanning the
    // store records — issues hold reporterId, which points at the right
    // per-user dir.
    if (isAdmin) {
      const all = await getIssuesStore().list();
      let hit = null;
      for (const issue of all) {
        const match = (issue.attachments || []).find((a) => a?.filename === name);
        if (match) { hit = { issue, attachment: match }; break; }
      }
      if (hit) {
        // Reconstruct the target path from the reporter's identity. Super-
        // admin's own legacy DATA_DIR is handled by dataDirFor() returning
        // DATA_DIR directly when the reporter IS the super-admin.
        const { dataDirFor } = await import("../lib/paths.js");
        const reporterDataDir = dataDirFor({ sub: hit.issue.reporterId, email: hit.issue.reporterEmail });
        const adminPath = path.join(reporterDataDir, "issue-attachments", name);
        if (fs.existsSync(adminPath)) {
          res.setHeader("Content-Type", mime);
          res.setHeader("Cache-Control", "private, max-age=0, no-store");
          return fs.createReadStream(adminPath).pipe(res);
        }
      }
    }

    return res.status(404).json({ ok: false, error: "not found" });
  } catch (e) {
    console.error("[ISSUES] attachment serve failed:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
