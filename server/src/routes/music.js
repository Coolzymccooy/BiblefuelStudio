import { Router } from "express";
import { listTracks } from "../lib/musicLibrary.js";

const router = Router();
router.get("/library", (_req, res) => res.json({ ok: true, tracks: listTracks() }));
export default router;
