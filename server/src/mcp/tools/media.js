import { z } from "zod";
import { ok, withoutOk } from "../toolResult.js";

const LIST_ROUTE = { audio: "/api/media/audio-list", video: "/api/media/video-list" };

const mediaList = {
  name: "media_list",
  title: "List media files",
  description:
    "The audio or video files in your media folder, newest first. Each item has name, path, size (bytes) and mtime. " +
    "The path is server-local and is what other tools accept (transcribe, media_trim, render and music tools). " +
    "Use it to find a file you uploaded, imported or rendered earlier.",
  inputSchema: { kind: z.enum(["audio", "video"]).describe("Which files to list: audio or video.") },
  routes: ["/api/media"],
  async handler(ctx, { kind }) {
    const body = await ctx.api.call("GET", LIST_ROUTE[kind]);
    return ok({ items: Array.isArray(body?.items) ? body.items : [] });
  },
};

const mediaImportUrl = {
  name: "media_import_url",
  title: "Import a file from a URL",
  description:
    "Download a file from a public http or https URL into your media folder so other tools can use it. " +
    "Returns the same fields as an upload, including file (the server-local path to pass to other tools) and mime. " +
    "Private, local or non-http addresses are refused (URL_PRIVATE, URL_SCHEME); oversized files fail with URL_TOO_LARGE.",
  inputSchema: {
    url: z.string().min(1).max(2048).describe("A public http(s) URL of the file to download."),
    kind: z.enum(["audio", "video", "image"]).optional().describe("What the file is. Default audio."),
    filename: z.string().max(200).optional().describe("Optional file name; only its extension is used as a hint."),
  },
  routes: ["/api/media"],
  async handler(ctx, { url, kind, filename }) {
    const body = await ctx.api.call("POST", "/api/media/import-url", { body: { url, kind, filename } });
    return ok(withoutOk(body));
  },
};

const mediaTrim = {
  name: "media_trim",
  title: "Trim an audio or video file",
  description:
    "Cut a file in your media folder to the range startSec to endSec and save it as a NEW file; the original is kept. " +
    "inputPath is a server-local path from media_list, media_import_url or a job's output.path. " +
    "Returns file (the new path) and durationSec.",
  inputSchema: {
    inputPath: z.string().min(1).describe("Path of the audio or video file to trim, from media_list or another tool."),
    startSec: z.number().min(0).describe("Where the cut starts, in seconds."),
    endSec: z.number().describe("Where the cut ends, in seconds. Must be at least 0.1 after startSec."),
  },
  routes: ["/api/media"],
  async handler(ctx, { inputPath, startSec, endSec }) {
    const body = await ctx.api.call("POST", "/api/media/trim", { body: { inputPath, startSec, endSec } });
    return ok(withoutOk(body));
  },
};

const transcribe = {
  name: "transcribe",
  title: "Transcribe audio or video",
  description:
    "Transcribe an audio or video file already on the server (a path from media_list, media_import_url or a job's output.path). " +
    "Returns words (each with text, startMs and endMs), durationMs, audioPath and which speech-to-text provider ran. " +
    "It can take a while for long files, and it counts against your daily render quota.",
  inputSchema: { mediaPath: z.string().min(1).describe("Server-local path of the audio or video file to transcribe.") },
  routes: ["/api/transcribe"],
  async handler(ctx, { mediaPath }) {
    const body = await ctx.api.call("POST", "/api/transcribe", { body: { mediaPath } });
    return ok(withoutOk(body));
  },
};

export default [mediaList, mediaImportUrl, mediaTrim, transcribe];
