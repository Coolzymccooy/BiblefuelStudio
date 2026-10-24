import { z } from "zod";
import { ok, fail } from "../toolResult.js";

// The content queue: post ideas (title, hook, verse, reflection, call to
// action, hashtags) saved for later, shown on the app's Queue page and
// exported there as CSV. Nothing here renders or posts.

const ACTIONS = ["list", "add", "remove", "clear"];
const ITEM_ID = z.string().trim().regex(/^[\w-]{1,80}$/, "a queue item id from queue_items list");

// lib/validators.js QueueAddSchema.
const itemSchema = z.object({
  title: z.string().min(2).max(120).describe("The post title."),
  hook: z.string().min(2).max(200).describe("The opening line."),
  verse: z.string().min(2).max(300).describe("The verse text."),
  reference: z.string().max(100).optional().describe("The verse reference, for example John 3:16."),
  reflection: z.string().min(2).max(300).describe("A short reflection."),
  cta: z.string().min(2).max(120).describe("The call to action."),
  hashtags: z.array(z.string().max(60)).max(30).optional().describe("Hashtags."),
  notes: z.string().max(2000).optional().describe("Private notes."),
});

const queueItems = {
  name: "queue_items",
  title: "Content queue",
  description:
    "The user's content queue: post ideas saved for later (the app's Queue page, which exports them as CSV). " +
    "action list: every item. add { item: { title, hook, verse, reference?, reflection, cta, hashtags?, notes? } }: saves one as a draft (scripts_generate makes such fields). " +
    "remove { id }: deletes one item. clear: deletes EVERY item in the queue; do it only when the user asked. " +
    "Nothing here renders or posts. Free: no daily cap or plan quota.",
  inputSchema: {
    action: z.enum(ACTIONS).describe("list, add, remove or clear."),
    item: itemSchema.optional().describe("add: the item to save."),
    id: ITEM_ID.optional().describe("remove: the item's id."),
  },
  routes: ["/api/queue"],
  async handler(ctx, { action, item, id }) {
    if (action === "list") return ok({ items: (await ctx.api.call("GET", "/api/queue"))?.items || [] });
    if (action === "clear") {
      await ctx.api.call("POST", "/api/queue/clear");
      return ok({ cleared: true });
    }
    if (action === "add") {
      if (!item) return fail("BAD_INPUT", "queue_items add needs item.");
      return ok({ item: (await ctx.api.call("POST", "/api/queue/add", { body: item }))?.item ?? null });
    }
    if (!id) return fail("BAD_INPUT", "queue_items remove needs id.");
    await ctx.api.call("DELETE", `/api/queue/${encodeURIComponent(id)}`);
    return ok({ id, removed: true });
  },
};

export default [queueItems];
