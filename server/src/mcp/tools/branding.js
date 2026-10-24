import { z } from "zod";
import { ok, fail, withoutOk } from "../toolResult.js";

const ACTIONS = ["get", "set"];
const POSITIONS = ["top-right", "top-left", "bottom-right", "bottom-left"];
const SIZES = ["small", "medium", "large"];
const SETTING_FIELDS = ["enabled", "position", "size", "opacity"];

/** The settings without the logo's inline preview image, which is large and no use to an agent. */
function settingsOnly(branding) {
  const { logoDataUrl: _preview, ...settings } = branding || {};
  return settings;
}

const branding = {
  name: "branding",
  title: "Video logo settings",
  description:
    "Your account's logo overlay, drawn in a corner of the videos you render. " +
    "action get: enabled, position, size, opacity and hasLogo (whether a logo is uploaded). " +
    "action set: change any of enabled (true or false), position (top-right, top-left, bottom-right or bottom-left), size (small, medium or large) and opacity (0.2 to 1). Only the fields you pass change. " +
    "Turning enabled on fails until a logo is uploaded, and the logo image itself can only be uploaded or removed in the app (Settings), not through this tool. Free and instant.",
  inputSchema: {
    action: z.enum(ACTIONS).describe("get or set."),
    enabled: z.boolean().optional().describe("set: draw the logo on rendered videos."),
    position: z.enum(POSITIONS).optional().describe("set: which corner."),
    size: z.enum(SIZES).optional().describe("set: small, medium or large."),
    opacity: z.number().min(0.2).max(1).optional().describe("set: 0.2 (faint) to 1 (solid)."),
  },
  routes: ["/api/branding"],
  async handler(ctx, input) {
    if (input.action === "get") {
      const body = await ctx.api.call("GET", "/api/branding");
      return ok({ branding: settingsOnly(body?.branding) });
    }
    const patch = Object.fromEntries(SETTING_FIELDS.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
    if (Object.keys(patch).length === 0) return fail("BAD_INPUT", "set needs at least one of enabled, position, size or opacity.");
    const body = await ctx.api.call("PUT", "/api/branding", { body: patch });
    return ok({ branding: settingsOnly(withoutOk(body).branding) });
  },
};

export default [branding];
