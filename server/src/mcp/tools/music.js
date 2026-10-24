import { z } from "zod";
import { ok } from "../toolResult.js";

const SOURCES = ["bundled", "upload"];
const QUALITIES = ["best", "fast"];
const DECISIONS = ["keep", "discard"];

const musicLibrary = {
  name: "music_library",
  title: "List music tracks",
  description:
    "The music you can use as a bed or remove vocals from: the bundled tracks (source bundled, cleared for commercial use) and the ones you added (source upload, which includes instrumentals you made). " +
    "Each track has id, label, mood, durationSec, licence, credit and ref. " +
    "Use id with music_remove_vocals. Use ref (library:... or mylib:...) wherever a tool asks for a music track, for example audio_advanced clips. " +
    "A track whose label ends in (vocal) has singing on it. Free and instant.",
  inputSchema: {
    source: z.enum(SOURCES).optional().describe("Only bundled tracks or only your uploads. Default: both."),
  },
  routes: ["/api/music"],
  async handler(ctx, { source }) {
    const body = await ctx.api.call("GET", "/api/music/library");
    const tracks = Array.isArray(body?.tracks) ? body.tracks : [];
    return ok({ tracks: source ? tracks.filter((track) => track.source === source) : tracks });
  },
};

const musicRemoveVocals = {
  name: "music_remove_vocals",
  title: "Remove vocals from a track",
  description:
    "Split the singing off a track from music_library so you get an instrumental. It takes MINUTES (a few minutes on this server, longer if the operator's laptop does it), so this returns a job handle straight away. " +
    "Next: jobs_wait with kind instrumental and the returned id, repeated until status is done; the finished instrumental is saved to your music library automatically (look for it in music_library with source upload, label ending (instrumental)). " +
    "Then call music_instrumental_decide to keep it, or to discard it and free the space. " +
    "Counts as one daily render and one of your plan's daily render quota. " +
    "Fails with 409 if vocal removal is not set up on this machine (capabilities shows music.vocalRemoval), and with 429 if you already have songs waiting.",
  inputSchema: {
    id: z.string().min(1).describe("The track's id from music_library (for example peaceful-worship), not its ref."),
    quality: z.enum(QUALITIES).optional().describe("best (default, slower) or fast."),
  },
  routes: ["/api/music"],
  caps: { renders: 1 },
  async handler(ctx, { id, quality }) {
    const body = await ctx.api.call("POST", `/api/music/${encodeURIComponent(id)}/instrumental`, {
      body: quality ? { quality } : {},
    });
    const where = body?.where === "laptop" ? "laptop" : "server";
    return ok({
      kind: "instrumental",
      id: String(body?.jobId ?? ""),
      status: where === "laptop" ? "queued" : "running",
      percent: null,
      phase: null,
      output: null,
      error: null,
      where,
      sourceId: id,
    });
  },
};

const musicInstrumentalDecide = {
  name: "music_instrumental_decide",
  title: "Keep or discard an instrumental",
  description:
    "Settle a music_remove_vocals job. keep returns the finished instrumental as a track (it is already in your music library; this just confirms it) and needs the job to be done, otherwise it fails with 409; call jobs_wait first. " +
    "discard also works on a running job: it cancels it, removes the track from your library and deletes the file. " +
    "jobId is the id music_remove_vocals returned. Free and instant.",
  inputSchema: {
    jobId: z.string().min(1).describe("The id from music_remove_vocals."),
    decision: z.enum(DECISIONS).describe("keep or discard."),
  },
  routes: ["/api/music"],
  async handler(ctx, { jobId, decision }) {
    const body = await ctx.api.call("POST", `/api/music/instrumental/${encodeURIComponent(jobId)}/${decision}`, { body: {} });
    return ok(decision === "keep" ? { decision, track: body?.track ?? null } : { decision, discarded: true });
  },
};

export default [musicLibrary, musicRemoveVocals, musicInstrumentalDecide];
