import { z } from "zod";
import { ok, withoutOk } from "../toolResult.js";

// Gumroad packs: a free lead-magnet ebook and a paid 30-day devotional, written
// as markdown from built-in templates. The route sits behind
// featureGate("gumroad"), so the tool is listed only to keys whose user's plan
// has that feature (super admins today).

const ZIP_PATH = "/api/gumroad/download.zip";
const ZIP_FILES = ["FREE-LEAD-MAGNET.md", "PAID-30-DAY-DEVOTIONAL.md", "README.txt"];

const gumroad = {
  name: "gumroad",
  title: "Gumroad product packs",
  description:
    "Make the two Gumroad products: a free lead-magnet ebook and a paid 30-day devotional, written as markdown from built-in templates (no AI, instant). " +
    "action generate { freeTitle?, paidTitle? }: makes both, saves them to the history and returns their full markdown, plus zip.url: a zip of the last pack made on the server (both files and a README) for the user to download while signed in to the app; " +
    "an agent key cannot open that link, so save the markdown returned here instead. action history { limit? }: the packs made before, newest first. " +
    "Free: no daily cap or plan quota.",
  inputSchema: {
    action: z.enum(["generate", "history"]).describe("generate or history."),
    freeTitle: z.string().trim().min(1).max(200).optional().describe("generate: the free ebook's title (default 7 Bible Verses for Anxiety & Fear)."),
    paidTitle: z.string().trim().min(1).max(200).optional().describe("generate: the paid devotional's title (default Biblefuel: 30 Days of Strength, Peace & Faith)."),
    limit: z.number().int().min(1).max(50).optional().describe("history: how many packs (default 50)."),
  },
  routes: ["/api/gumroad"],
  requires: "feature:gumroad",
  async handler(ctx, { action, freeTitle, paidTitle, limit }) {
    if (action === "history") {
      const body = await ctx.api.call("GET", "/api/gumroad/history", limit ? { query: { limit } } : undefined);
      return ok({ items: body?.items || [] });
    }
    const titles = Object.fromEntries(Object.entries({ freeTitle, paidTitle }).filter(([, v]) => v !== undefined));
    const pack = withoutOk(await ctx.api.call("POST", "/api/gumroad/generate", { body: titles }));
    const base = String(ctx.publicBase || "").replace(/\/+$/, "");
    return ok({ ...pack, zip: { url: `${base}${ZIP_PATH}`, needsSignIn: true, files: ZIP_FILES } });
  },
};

export default [gumroad];
