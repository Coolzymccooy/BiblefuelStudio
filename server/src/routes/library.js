import { Router } from "express";
import { readLibrary, addToLibrary, removeFromLibrary } from "../lib/library.js";

const router = Router();

router.get("/", (req, res) => {
    res.json({ ok: true, library: readLibrary() });
});

router.post("/add", (req, res) => {
    const item = req.body || {};
    if (!item.id) return res.status(400).json({ ok: false, error: "id required" });
    addToLibrary(item);
    res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
    removeFromLibrary(req.params.id);
    res.json({ ok: true });
});

export default router;
