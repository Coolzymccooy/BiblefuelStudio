import { Router } from "express";
import { GenerateScriptsSchema } from "../lib/validators.js";
import { generateScripts } from "../lib/generateScripts.js";

const router = Router();

router.post("/generate", async (req, res) => {
  try {
    const input = GenerateScriptsSchema.parse(req.body || {});
    const scripts = await generateScripts(input);
    res.json({ ok: true, scripts });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
