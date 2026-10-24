import fs from "fs";
import path from "path";
import { Router } from "express";
import { DATA_DIR, OUTPUT_DIR } from "../lib/paths.js";
import { isSeedanceConfigured } from "../lib/videoGen/providers/seedance.js";
import { wouldExceedCap, ledgerSummary, releaseSpend } from "../lib/videoGen/spend.js";
import { lookupVerses } from "../lib/bible/scriptureApi.js";
import {
  createProject, readProject, updateProject, listProjects, deleteProject, isProjectId,
} from "../lib/cartoon/store.js";
import { estimateFilm, reservedSpeakers } from "../lib/cartoon/model.js";
import { MAX_SCRIPT_CHARS } from "../lib/cartoon/parse.js";
import { STYLES, DEFAULT_STYLE, isStyleName } from "../lib/cartoon/styles.js";
import { EXAMPLES, PLACEHOLDER } from "../lib/cartoon/examples.js";
import { writeCartoonScript } from "../lib/cartoon/writer.js";
import { makePortrait } from "../lib/cartoon/images.js";
import { startFilm, isFilming, cancelFilm, resumeFilm, filmHoldKey } from "../lib/cartoon/filmStage.js";
import {
  startCartoonRender, isRenderingCartoon, cancelCartoonRender, cartoonRenderBlockers, cartoonRenderWarnings,
  recoverInterruptedCartoonRender,
} from "../lib/cartoon/renderStage.js";
import { listShelf, shelve, fromShelf, removeFromShelf } from "../lib/cartoon/shelf.js";
import {
  applyEdit, rescript, scriptDraft, fits, tooLongSentence, checkOf, isLocked,
  ownMember, isPlainName, unreadyCast, listNames, drawnInOldStyle,
} from "../lib/cartoon/edits.js";

/**
 * Cartoon mode API (spec section 7): script, cast portraits, shot list, film,
 * render.
 * Super admins only, like scene scripts: one BytePlus balance pays for every
 * clip, so the spend ledger lives in the shared DATA_DIR. Mounted behind
 * requireAuth + withUserScope + requireVerifiedEmail + requireSuperAdmin.
 *
 * Portraits, the film and the render run in the background; the page polls GET /:id.
 * Errors are always { ok: false, code, error } with a sentence a person can
 * act on. Express 4 does not catch a rejected async handler, so every handler
 * goes through `handle`, which answers 500 instead of leaving the request
 * hanging.
 */

const WRITE_TIMEOUT_MS = 60_000;
const VERSE_TIMEOUT_MS = 10_000;
const MAX_ONLY = 20;
const INTERRUPTED_PORTRAIT = "Interrupted by a restart. Make it again.";
const NOT_FOUND = "Cartoon not found.";
const OLD_STYLE = "This portrait was drawn in the old style. Make it again first.";

const fail = (res, status, code, error, extra = {}) => res.status(status).json({ ok: false, code, error, ...extra });
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

/** Projects with a portrait run going in this process. */
const portraitRuns = new Set();
export const isMakingPortraits = (id) => portraitRuns.has(id);

const isRendering = isRenderingCartoon;

/** A portrait left "making" by a restart has no worker; show it as stopped so it can be made again. */
function recoverPortraits(project) {
  if (!project || portraitRuns.has(project.id)) return project;
  const stuck = Object.values(project.cast || {}).some((m) => m?.portrait?.status === "making");
  if (!stuck) return project;
  return {
    ...project,
    cast: Object.fromEntries(Object.entries(project.cast).map(([name, m]) => [
      name,
      m?.portrait?.status === "making" ? { ...m, portrait: { ...m.portrait, status: "error", error: INTERRUPTED_PORTRAIT } } : m,
    ])),
  };
}

/** A copy without its `file` field: the page gets URLs, never paths on the server. */
function withoutFile(value) {
  if (!value || typeof value !== "object") return value ?? null;
  const { file: _file, ...rest } = value;
  return rest;
}

const publicClip = (clip) => (clip ? { ...withoutFile(clip), previous: withoutFile(clip.previous) } : null);

/** The render state with its URL; the stored file names stay on the server. */
function publicRender(render) {
  if (!render || typeof render !== "object") return { status: "idle" };
  const { previous: _previous, ...rest } = withoutFile(render);
  return rest;
}

function blockersOf(project) {
  const blockers = [];
  const waiting = unreadyCast(project);
  if (waiting.length) blockers.push(`Approve the portrait${waiting.length > 1 ? "s" : ""} of ${listNames(waiting)} first.`);
  if (!project.shotListApproved) blockers.push("Approve the shot list.");
  return blockers;
}

/**
 * The project as the page sees it: stored fields plus what is derived from
 * them. A render left running by a restart shows as stopped. `renderBlockers`
 * stop a render; `renderWarnings` (shots made from an out-of-date frame) do not.
 */
function view(raw, ctx) {
  const project = recoverInterruptedCartoonRender(recoverPortraits(raw));
  const check = checkOf(project);
  const { source = {}, ...rest } = project;
  return {
    ...rest,
    source: { markdown: source.markdown ?? "", ignored: source.ignored || [], warnings: source.warnings || [], parsedAt: source.parsedAt },
    cast: Object.fromEntries(Object.entries(project.cast || {}).map(([name, m]) => [name, { ...m, portrait: withoutFile(m?.portrait) }])),
    shots: (project.shots || []).map((s) => ({ ...s, clip: publicClip(s.clip) })),
    check,
    fits: fits(check),
    estimate: estimateFilm(project),
    running: { pictures: portraitRuns.has(project.id), film: isFilming(project.id), render: isRendering(project.id) },
    blockers: blockersOf(project),
    render: publicRender(project.render),
    renderBlockers: ctx ? cartoonRenderBlockers(ctx, project) : [],
    renderWarnings: cartoonRenderWarnings(project),
  };
}

/** The verse text for a reference, best effort: "" on any failure or after 10 s. */
async function verseTextFor(reference, lookup) {
  if (!reference) return "";
  let timer;
  try {
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), VERSE_TIMEOUT_MS); });
    const found = await Promise.race([Promise.resolve().then(() => lookup(reference)), timeout]);
    if (!found || found.ok === false || !Array.isArray(found.verses)) return "";
    return found.verses.map((v) => String(v?.text ?? "").trim()).filter(Boolean).join(" ");
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** Wraps a handler so a throw or rejection answers 500 rather than hanging the request. */
const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (e) {
    console.warn(`[cartoon] ${req.method} ${req.originalUrl || req.url} failed: ${e?.message || e}`);
    if (!res.headersSent) fail(res, 500, "SERVER_ERROR", "Something went wrong. Please try again.");
  }
};

/** Shelf errors carry a code: NOT_FOUND is 404, INVALID is 400; anything else is a server error. */
function shelfFailure(res, e) {
  if (e?.code === "NOT_FOUND") return fail(res, 404, "NOT_FOUND", e.message);
  if (e?.code === "INVALID") return fail(res, 400, "INVALID", e.message);
  throw e;
}

const onlyOf = (body) => (Array.isArray(body?.only)
  ? body.only.filter((x) => typeof x === "string" && x.length <= 100).slice(0, MAX_ONLY)
  : undefined);

/**
 * What the cap check counts: every shot without a done clip, plus the done
 * shots `only` names (paid re-makes). Each shot is counted once.
 */
function budgetUsd(project, only) {
  const wanted = new Set(only || []);
  const remakes = project.shots.filter((s) => wanted.has(s.id) && s.clip?.status === "done").map((s) => s.id);
  return estimateFilm(project).usd + (remakes.length ? estimateFilm(project, remakes).usd : 0);
}

/** Mark the named portraits as being made, and un-approve the shot list: the cast is changing. */
function markMaking(project, names) {
  const cast = { ...project.cast };
  for (const name of names) {
    const old = cast[name].portrait || {};
    cast[name] = { ...cast[name], portrait: { ...old, file: old.file ?? null, url: old.url ?? null, status: "making", error: null } };
  }
  return { ...project, cast, shotListApproved: false };
}

/** Make each named portrait in turn, in the background. One failure never stops the rest. */
function runPortraits(ctx, id, names, image) {
  portraitRuns.add(id);
  const makeAll = async () => {
    for (const name of names) {
      try {
        await makePortrait(ctx, { id }, name, { image });
      } catch (e) {
        console.warn(`[cartoon] portrait ${name} of ${id} failed: ${e?.message || e}`);
        updateProject(ctx.dataDir, id, (p) => (ownMember(p, name)?.portrait?.status === "making"
          ? { ...p, cast: { ...p.cast, [name]: { ...p.cast[name], portrait: { ...p.cast[name].portrait, status: "error", error: "The picture could not be made. Please try again in a moment." } } } }
          : null));
      }
    }
  };
  Promise.resolve()
    .then(makeAll)
    .catch((e) => console.warn(`[cartoon] portraits of ${id} failed: ${e?.message || e}`))
    .finally(() => portraitRuns.delete(id));
}

export function createCartoonRouter({ ledgerDir = DATA_DIR, deps = {}, writeTimeoutMs = WRITE_TIMEOUT_MS } = {}) {
  const router = Router();
  const lookup = deps.lookup || lookupVerses;
  const writerDeps = { ...(deps.llm ? { llm: deps.llm } : {}), ...(deps.lookup ? { lookup: deps.lookup } : {}) };

  const load = (req, res) => {
    if (!isProjectId(req.params.id)) { fail(res, 404, "NOT_FOUND", NOT_FOUND); return null; }
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) { fail(res, 404, "NOT_FOUND", NOT_FOUND); return null; }
    return recoverPortraits(project);
  };
  const markdownOf = (res, md) => {
    if (typeof md !== "string" || !md.trim()) { fail(res, 400, "BAD_REQUEST", "Paste a script first."); return null; }
    if (md.length > MAX_SCRIPT_CHARS) { fail(res, 413, "TOO_LONG", `Scripts are limited to ${MAX_SCRIPT_CHARS.toLocaleString("en-GB")} characters.`); return null; }
    return md;
  };
  /** A parsed script that can be filmed, or null after answering why not. */
  const filmableDraft = (res, md) => {
    const draft = scriptDraft(md);
    if (!draft.fresh.shots.length) { fail(res, 400, "NO_SHOTS", "The script has no lines to film yet. Add a Scene: and a spoken line."); return null; }
    const reserved = reservedSpeakers(draft.fresh);
    if (reserved.length) { fail(res, 400, "BAD_NAME", `"${reserved[0]}" can't be used as a character name. Rename the character.`); return null; }
    if (!fits(draft.fresh.check)) { fail(res, 400, "TOO_LONG_FILM", tooLongSentence(draft.fresh.check), { check: draft.fresh.check }); return null; }
    return draft;
  };
  const castBusy = (res, id) => {
    if (isFilming(id)) { fail(res, 409, "RUNNING", "Wait for the film to finish, or stop it, first."); return true; }
    if (portraitRuns.has(id)) { fail(res, 409, "RUNNING", "Wait for the portraits to finish first."); return true; }
    return false;
  };

  router.get("/styles", (_req, res) => res.json({
    ok: true, styles: Object.values(STYLES).map(({ id, label }) => ({ id, label })), defaultStyle: DEFAULT_STYLE,
  }));

  router.get("/examples", (_req, res) => res.json({
    ok: true,
    examples: EXAMPLES.map(({ id, title, verse, blurb, markdown }) => ({ id, title, verse, blurb, markdown })),
    placeholder: PLACEHOLDER,
  }));

  router.get("/shelf", handle((req, res) => res.json({ ok: true, characters: listShelf(req.ctx) })));

  router.delete("/shelf/:characterId", handle((req, res) => {
    if (!removeFromShelf(req.ctx, String(req.params.characterId))) return fail(res, 404, "NOT_FOUND", "No character on the shelf with that id.");
    return res.json({ ok: true });
  }));

  router.get("/", handle((req, res) => res.json({ ok: true, projects: listProjects(req.ctx.dataDir) })));

  router.post("/parse", handle((req, res) => {
    const md = markdownOf(res, req.body?.markdown);
    if (md === null) return undefined;
    const { fresh } = scriptDraft(md);
    const draft = { id: "preview", ...fresh };
    const { source, ...rest } = draft;
    return res.json({
      ok: true,
      preview: { ...rest, source: { ignored: source.ignored, warnings: source.warnings } },
      check: fresh.check,
      fits: fits(fresh.check),
      estimate: estimateFilm(draft),
    });
  }));

  router.post("/write", handle(async (req, res) => {
    const body = req.body || {};
    const ask = { verse: str(body.verse, 80) ?? "", theme: str(body.theme, 400) ?? "", cast: str(body.cast, 1500) ?? "", style: str(body.style, 40) ?? "" };
    if (ask.style !== "" && !isStyleName(ask.style)) return fail(res, 400, "BAD_STYLE", "Choose one of the cartoon styles.");
    let timer;
    try {
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, code: "TIMEOUT" }), writeTimeoutMs); });
      const r = await Promise.race([writeCartoonScript(ask, writerDeps), timeout]);
      if (r.ok) return res.json({ ok: true, markdown: r.markdown, verseText: r.verseText });
      if (r.code === "TIMEOUT") return fail(res, 504, "TIMEOUT", "Writing the script took too long. Try again.");
      if (r.code === "NO_VERSE") return fail(res, 400, "NO_VERSE", r.error);
      // The writer's fixed sentence only; its reasons hold the model's own words.
      return fail(res, 422, "WRITE_FAILED", r.code === "WRITE_FAILED" ? r.error : "BibleFuel couldn't write a script that fits. Try again.");
    } finally {
      clearTimeout(timer);
    }
  }));

  router.post("/", handle(async (req, res) => {
    const body = req.body || {};
    let md;
    if (body.exampleId !== undefined) {
      const example = EXAMPLES.find((e) => e.id === body.exampleId);
      if (!example) return fail(res, 404, "NOT_FOUND", "No example with that id.");
      md = example.markdown;
    } else {
      md = markdownOf(res, body.markdown);
      if (md === null) return undefined;
    }
    const draft = filmableDraft(res, md);
    if (!draft) return undefined;
    const text = await verseTextFor(draft.fresh.meta.verse.reference, lookup);
    const fields = { ...draft.fresh, meta: { ...draft.fresh.meta, verse: { ...draft.fresh.meta.verse, text } } };
    const project = createProject(req.ctx.dataDir, fields);
    return res.status(201).json({ ok: true, project: view(project, req.ctx) });
  }));

  router.get("/:id", handle((req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    return res.json({ ok: true, project: view(project, req.ctx), month: ledgerSummary(ledgerDir), seedance: isSeedanceConfigured() });
  }));

  router.patch("/:id", handle(async (req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (isRendering(project.id)) return fail(res, 409, "RENDERING", "Wait for the render to finish before editing.");
    const touchesCast = ["markdown", "cast", "style"].some((k) => body[k] !== undefined);
    if ((touchesCast || body.shots !== undefined) && isFilming(project.id)) {
      return fail(res, 409, "RUNNING", "Wait for the film to finish, or stop it, before changing the script, cast or shots.");
    }
    if (touchesCast && portraitRuns.has(project.id)) return fail(res, 409, "RUNNING", "Wait for the portraits to finish first.");

    let draft = null;
    let verseText = project.meta?.verse?.text || "";
    if (body.markdown !== undefined) {
      const md = markdownOf(res, body.markdown);
      if (md === null) return undefined;
      if (isLocked(project)) return fail(res, 409, "LOCKED", "The lines are locked once a clip has been ordered. Start over to change them; the clips stay in the library.");
      draft = filmableDraft(res, md);
      if (!draft) return undefined;
      const reference = draft.fresh.meta.verse.reference;
      if (reference !== project.meta?.verse?.reference) verseText = await verseTextFor(reference, lookup);
    }

    // Checked again inside the write: a film or portrait run may have started while the verse was looked up.
    let refused = null;
    const saved = updateProject(req.ctx.dataDir, project.id, (current) => {
      if (draft && (isFilming(current.id) || portraitRuns.has(current.id))) { refused = "RUNNING"; return null; }
      if (draft && isLocked(current)) { refused = "LOCKED"; return null; }
      return applyEdit(draft ? rescript(current, draft, { verseText }) : current, body);
    });
    if (refused === "RUNNING") return fail(res, 409, "RUNNING", "Wait for the film and portraits to finish before changing the script.");
    if (refused === "LOCKED") return fail(res, 409, "LOCKED", "The lines are locked once a clip has been ordered. Start over to change them; the clips stay in the library.");
    if (!saved) return fail(res, 404, "NOT_FOUND", NOT_FOUND);
    return res.json({ ok: true, project: view(saved, req.ctx) });
  }));

  router.delete("/:id", handle((req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    if (isFilming(project.id) || portraitRuns.has(project.id) || isRendering(project.id)) {
      return fail(res, 409, "BUSY", "Stop the running step before deleting this cartoon.");
    }
    // The visual library keeps its own copies of the clips.
    deleteProject(req.ctx.dataDir, req.ctx.outputDir, project.id);
    // No run is going, so any hold left for this cartoon covers nothing.
    releaseSpend(ledgerDir, filmHoldKey(project.id));
    return res.json({ ok: true });
  }));

  router.post("/:id/portraits", handle((req, res) => {
    const project = load(req, res);
    if (!project || castBusy(res, project.id)) return undefined;
    const only = onlyOf(req.body);
    let names;
    if (only && only.length) {
      const unknown = only.find((name) => !ownMember(project, name));
      if (unknown !== undefined) return fail(res, 404, "NOT_FOUND", `No character called ${unknown.slice(0, 40)}.`);
      names = [...new Set(only)];
    } else {
      names = Object.entries(project.cast || {}).filter(([, m]) => m?.portrait?.status !== "done").map(([name]) => name);
    }
    if (!names.length) return fail(res, 400, "NOTHING_TO_MAKE", "Every character already has a portrait.");
    let present = [];
    const marked = updateProject(req.ctx.dataDir, project.id, (p) => {
      present = names.filter((n) => ownMember(p, n));
      return present.length ? markMaking(p, present) : null;
    });
    if (!marked) return fail(res, 404, "NOT_FOUND", NOT_FOUND);
    runPortraits(req.ctx, project.id, present, deps.image);
    return res.json({ ok: true, project: view(marked, req.ctx) });
  }));

  router.post("/:id/cast/from-shelf", handle((req, res) => {
    const project = load(req, res);
    if (!project || castBusy(res, project.id)) return undefined;
    const characterId = req.body?.characterId;
    if (typeof characterId !== "string" || !characterId) return fail(res, 400, "INVALID", "Choose a character from the shelf.");
    const asName = typeof req.body?.asName === "string" ? req.body.asName.slice(0, 40) : undefined;
    let pulled;
    try {
      pulled = fromShelf(req.ctx, project, characterId, asName);
    } catch (e) {
      return shelfFailure(res, e);
    }
    const saved = pulled.shotListApproved ? updateProject(req.ctx.dataDir, project.id, (p) => ({ ...p, shotListApproved: false })) : pulled;
    return res.json({ ok: true, project: view(saved || pulled, req.ctx) });
  }));

  router.post("/:id/cast/:name/approve", handle((req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    const name = String(req.params.name);
    const member = ownMember(project, name);
    if (!member) return fail(res, 404, "NOT_FOUND", "No character with that name.");
    if (member.portrait?.status !== "done" || !member.portrait.url) return fail(res, 409, "NO_PORTRAIT", `Make ${name}'s portrait first.`);
    if (drawnInOldStyle(member, project.meta?.style)) return fail(res, 409, "STYLE_CHANGED", OLD_STYLE);
    let oldStyle = false;
    const saved = updateProject(req.ctx.dataDir, project.id, (p) => {
      const current = ownMember(p, name);
      if (current?.portrait?.status !== "done") return null;
      // Checked again inside the write: the style may have changed since the read.
      if (drawnInOldStyle(current, p.meta?.style)) { oldStyle = true; return null; }
      return { ...p, cast: { ...p.cast, [name]: { ...current, approved: true } } };
    });
    if (oldStyle) return fail(res, 409, "STYLE_CHANGED", OLD_STYLE);
    if (!saved) return fail(res, 409, "NO_PORTRAIT", `Make ${name}'s portrait first.`);
    return res.json({ ok: true, project: view(saved, req.ctx) });
  }));

  router.post("/:id/cast/:name/shelve", handle((req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    const name = String(req.params.name);
    if (!isPlainName(name)) return fail(res, 404, "NOT_FOUND", "No character with that name.");
    try {
      return res.json({ ok: true, character: shelve(req.ctx, project, name) });
    } catch (e) {
      return shelfFailure(res, e);
    }
  }));

  router.post("/:id/shots/approve", handle((req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    const waiting = unreadyCast(project);
    if (waiting.length) {
      return fail(res, 409, "CAST_NOT_READY", `Approve the portrait${waiting.length > 1 ? "s" : ""} of ${listNames(waiting)} first.`, { waiting });
    }
    const saved = updateProject(req.ctx.dataDir, project.id, (p) => ({ ...p, shotListApproved: true }));
    if (!saved) return fail(res, 404, "NOT_FOUND", NOT_FOUND);
    return res.json({ ok: true, project: view(saved, req.ctx) });
  }));

  router.post("/:id/film/estimate", handle((req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    return res.json({ ok: true, estimate: estimateFilm(project, onlyOf(req.body)), month: ledgerSummary(ledgerDir) });
  }));

  router.post("/:id/film", handle((req, res) => {
    if (!isSeedanceConfigured()) return fail(res, 503, "NOT_CONFIGURED", "AI video is not set up on this server.");
    const project = load(req, res);
    if (!project) return undefined;
    if (!project.shotListApproved) return fail(res, 409, "SHOTS_NOT_APPROVED", "Approve the shot list before ordering the film.");
    // A backstop: an approved shot list should mean an approved cast, but a clip is paid for, so check again.
    const waiting = unreadyCast(project);
    if (waiting.length) {
      return fail(res, 409, "CAST_NOT_READY", `Approve the portrait${waiting.length > 1 ? "s" : ""} of ${listNames(waiting)} first.`, { waiting });
    }
    if (isRendering(project.id)) return fail(res, 409, "RENDERING", "Wait for the render to finish, or stop it, first.");
    if (isFilming(project.id)) return fail(res, 409, "RUNNING", "The film is already being made.");
    const only = onlyOf(req.body);
    const est = estimateFilm(project, only);
    if (!est.clips && !est.refetch) return fail(res, 400, "NOTHING_TO_ORDER", "Every shot already has a clip.");
    // Fetching clips already paid for costs nothing, so neither the cap nor the benchmark applies.
    const paysNothing = est.clips === 0;
    // The whole remaining film, plus any paid re-make of a done shot, must fit the monthly cap,
    // so a film is never left half-made (spec section 7.6). Checked here first so a film over the
    // cap is refused before the benchmark question; startFilm checks again as it holds the money.
    const mustFit = paysNothing ? 0 : budgetUsd(project, only);
    const budget = paysNothing ? { exceeded: false } : wouldExceedCap(ledgerDir, mustFit);
    if (budget.exceeded) return fail(res, 409, "BUDGET", budget.error);
    if (!paysNothing && est.overBenchmark && req.body?.confirmOverBenchmark !== true) {
      return fail(res, 409, "OVER_BENCHMARK", `This cartoon would cost about $${est.totalUsd.toFixed(2)}, above the $${est.benchmarkUsd} benchmark. Confirm to go ahead.`, { estimate: est });
    }
    const started = startFilm(req.ctx, project.id, { only, ledgerDir, deps: deps.film, budgetUsd: mustFit });
    if (!started) return fail(res, 409, "RUNNING", "The film is already being made.");
    if (started.ok === false) return fail(res, 409, started.code, started.error);
    return res.json({ ok: true, project: view(started, req.ctx) });
  }));

  router.post("/:id/film/cancel", handle((req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    return res.json({ ok: true, stopping: cancelFilm(project.id) });
  }));

  router.post("/:id/render", handle((req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    if (isRendering(project.id)) return fail(res, 409, "RUNNING", "This cartoon is already rendering.");
    if (isFilming(project.id) || portraitRuns.has(project.id)) return fail(res, 409, "BUSY", "Wait for the film and portraits to finish first.");
    const blockers = cartoonRenderBlockers(req.ctx, project);
    if (blockers.length) return fail(res, 409, "NOT_READY", blockers[0], { blockers });
    const started = startCartoonRender(req.ctx, project.id, { deps: deps.render });
    if (!started) return fail(res, 409, "RUNNING", "This cartoon is already rendering.");
    return res.json({ ok: true, project: view(started, req.ctx) });
  }));

  router.post("/:id/render/cancel", handle((req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    return res.json({ ok: true, stopping: cancelCartoonRender(project.id) });
  }));

  return router;
}

/** Every data folder that has cartoons: the owner's and each other user's. */
function cartoonContexts(dataDir, outputDir) {
  const out = [];
  if (fs.existsSync(path.join(dataDir, "cartoons"))) out.push({ dataDir, outputDir });
  const usersDir = path.join(dataDir, "users");
  if (fs.existsSync(usersDir)) {
    for (const sub of fs.readdirSync(usersDir)) {
      const userDir = path.join(usersDir, sub);
      if (fs.existsSync(path.join(userDir, "cartoons"))) out.push({ dataDir: userDir, outputDir: path.join(userDir, "outputs") });
    }
  }
  return out;
}

/**
 * After a restart: collect clips ordered before it and end shots that were
 * never ordered. Every context is started before any collect is awaited:
 * resumeFilm marks a context's cartoons running synchronously, so no cartoon
 * waits unclaimed (where a film start or a delete could slip in) while another
 * user's clips are still arriving.
 */
export async function resumeCartoonFilms({ ledgerDir = DATA_DIR, dataDir = DATA_DIR, outputDir = OUTPUT_DIR, deps } = {}) {
  const runs = cartoonContexts(dataDir, outputDir).map((ctx) => resumeFilm(ctx, listProjects(ctx.dataDir), { ledgerDir, deps }));
  const counts = await Promise.all(runs);
  return counts.reduce((sum, n) => sum + n, 0);
}
