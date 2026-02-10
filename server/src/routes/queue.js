import { Router } from "express";
import { v4 as uuid } from "uuid";
import { QueueAddSchema } from "../lib/validators.js";
import { appendQueueItem, readQueue, deleteQueueItem, clearQueue } from "../lib/store.js";
import { stringify } from "csv-stringify/sync";

const router = Router();

router.get("/", (req, res) => {
  res.json({ ok: true, ...readQueue() });
});

router.post("/add", (req, res) => {
  try {
    const item = QueueAddSchema.parse(req.body || {});
    const saved = appendQueueItem({
      id: uuid(),
      createdAt: new Date().toISOString(),
      status: "draft",
      ...item,
      hashtags: item.hashtags || []
    });
    res.json({ ok: true, item: saved });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

router.delete("/:id", (req, res) => {
  const { id } = req.params;
  const success = deleteQueueItem(id);
  if (success) {
    res.json({ ok: true });
  } else {
    res.status(404).json({ ok: false, error: "Item not found" });
  }
});

router.post("/clear", (req, res) => {
  clearQueue();
  res.json({ ok: true });
});

router.get("/export.csv", (req, res) => {
  const q = readQueue();
  const rows = q.items.map(x => ({
    title: x.title,
    hook: x.hook,
    verse: x.verse,
    reference: x.reference,
    reflection: x.reflection,
    cta: x.cta,
    hashtags: (x.hashtags || []).join(" "),
    notes: x.notes || ""
  }));
  const csv = stringify(rows, { header: true });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=biblefuel-queue.csv");
  res.send(csv);
});

export default router;
