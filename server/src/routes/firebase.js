import { Router } from "express";
import { resolveOutputAlias } from "../lib/mediaThumb.js";
import { isFirebaseAdminEnabled, uploadLocalFileToFirebase } from "../lib/firebaseAdmin.js";

const router = Router();

router.get("/status", (req, res) => {
  const enabled = isFirebaseAdminEnabled();
  res.json({ ok: true, enabled });
});

router.post("/upload-output", async (req, res) => {
  try {
    if (!isFirebaseAdminEnabled()) {
      return res.status(400).json({ ok: false, error: "Firebase Storage not configured" });
    }
    const inputPath = String(req.body?.path || req.body?.filePath || "").trim();
    if (!inputPath) return res.status(400).json({ ok: false, error: "path required" });

    const localPath = resolveOutputAlias(inputPath);
    if (!localPath || String(localPath).startsWith("http")) {
      return res.status(400).json({ ok: false, error: `Local output path required: ${inputPath}` });
    }

    const prefix = String(req.body?.prefix || "outputs").trim() || "outputs";
    const uploaded = await uploadLocalFileToFirebase(localPath, { prefix });
    res.json({ ok: true, uploaded });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;

