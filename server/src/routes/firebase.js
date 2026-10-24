import { Router } from "express";
import { isFirebaseAdminEnabled, uploadLocalFileToFirebase } from "../lib/firebaseAdmin.js";
import { confineUserPath, sendUserPathError } from "../lib/userPathScope.js";

const router = Router();

const DEFAULT_FIREBASE = { enabled: isFirebaseAdminEnabled, upload: uploadLocalFileToFirebase };
let firebase = DEFAULT_FIREBASE;

/** Test seam: replace the storage calls ({ enabled, upload }). Pass null to restore. */
export function _setFirebaseForTests(impl) {
  firebase = impl && typeof impl === "object" ? { ...DEFAULT_FIREBASE, ...impl } : DEFAULT_FIREBASE;
}

router.get("/status", (req, res) => {
  const enabled = firebase.enabled();
  res.json({ ok: true, enabled });
});

router.post("/upload-output", async (req, res) => {
  try {
    if (!firebase.enabled()) {
      return res.status(400).json({ ok: false, error: "Firebase Storage not configured" });
    }
    const inputPath = String(req.body?.path || req.body?.filePath || "").trim();
    if (!inputPath) return res.status(400).json({ ok: false, error: "path required" });

    // This publishes the file behind a signed URL: only the caller's own
    // output folder, never a shared or other tenant's file (#112).
    let localPath;
    try {
      localPath = confineUserPath(inputPath, req.ctx);
    } catch (err) {
      if (sendUserPathError(res, err)) return;
      throw err;
    }

    const prefix = String(req.body?.prefix || "outputs").trim() || "outputs";
    const uploaded = await firebase.upload(localPath, { prefix });
    res.json({ ok: true, uploaded });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
