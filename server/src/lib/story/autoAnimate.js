import { readProject, writeProject } from "./projectStore.js";
import { animatableScenes, estimateAnimation, startAnimation, qualityOf, isAnimating, ledgerKey } from "./animateStage.js";
import { ledgerSummary, readLedger } from "../videoGen/spend.js";
import { isSeedanceConfigured } from "../videoGen/providers/seedance.js";
import { DATA_DIR } from "../paths.js";

/**
 * Series "AI motion": once an aiMotion project's pictures are ready, animate
 * its scenes without anyone clicking Animate, within the month's cap.
 *
 * It spends once per project. aiMotion.autoStartedAt is written before any
 * clip is ordered, so a later resegment (which makes new pictures and comes
 * back through the images stage) never spends again on its own; re-rolls are
 * the user's Animate buttons. When the cap would be crossed it animates as
 * many scenes as fit, in scene order, and says so in aiMotion.note.
 *
 * It never throws: it runs after the images stage and must never fail it.
 */

export const NOT_CONFIGURED_NOTE = "AI motion is not set up on the server.";
export const BUDGET_NOTE = (picked, total) => `${picked} of ${total} scenes animated: monthly AI budget reached`;
export const BUSY_NOTE = "AI motion could not start because another animation is running. Use Animate when it finishes.";
export const FAILED_NOTE = (message) => {
  const text = String(message).trim();
  return `AI motion could not start: ${text}${/[.!?]$/.test(text) ? "" : "."} Use Animate to try again.`;
};

// The ledger's own tolerance, so a batch that exactly meets the cap still fits.
const EPSILON = 1e-9;

/** Mark the one automatic try made, on the latest project on disk. */
function markStarted(dataDir, projectId, note) {
  const fresh = readProject(dataDir, projectId);
  if (!fresh?.aiMotion) return null;
  return writeProject(dataDir, {
    ...fresh,
    aiMotion: { ...fresh.aiMotion, autoStartedAt: fresh.aiMotion.autoStartedAt ?? Date.now(), note },
    updatedAt: Date.now(),
  });
}

// Scenes an auto run picked whose clip is not reserved in the ledger yet, by
// project: { dataDir, scenes: [{ id, usd }] }. A run reserves each clip only
// as it orders it (a few at a time), so another project picking meanwhile
// must not count that money as free. An entry ends with its run.
const picks = new Map();

/** What other projects' auto runs have picked but not yet reserved. */
function unreservedPicksUsd(ledgerDir) {
  const { reservations } = readLedger(ledgerDir);
  let usd = 0;
  for (const [projectId, entry] of picks) {
    if (!isAnimating(projectId)) { picks.delete(projectId); continue; }
    const scenes = readProject(entry.dataDir, projectId)?.scenes || [];
    for (const pick of entry.scenes) {
      // Queued and not reserved: not ordered yet. Reserved ones are in the
      // ledger's own total; anything else is done, failed or stopped.
      const queued = scenes.some((s) => s.id === pick.id && s.aiVideoStatus === "queued");
      if (queued && !Object.hasOwn(reservations, ledgerKey(projectId, pick.id))) usd += pick.usd;
    }
  }
  return usd;
}

/** The scenes that fit in what is left of the month's budget, in scene order. */
function pickWithinBudget(project, scenes, quality, ledgerDir) {
  const { capUsd, spentUsd, reservedUsd } = ledgerSummary(ledgerDir);
  const left = capUsd - spentUsd - reservedUsd - unreservedPicksUsd(ledgerDir);
  const picked = [];
  let total = 0;
  for (const s of scenes) {
    const usd = estimateAnimation(project, [s.id], quality).usd;
    // A long scene that does not fit is skipped: a shorter one later may.
    if (total + usd > left + EPSILON) continue;
    total += usd;
    picked.push({ id: s.id, usd });
  }
  return { picked, total: scenes.length };
}

/**
 * @param {{ dataDir: string, outputDir: string }} ctx
 * @param {string} projectId
 * @param {{ ledgerDir?: string, deps?: object, start?: typeof startAnimation,
 *   sceneBlocked?: (project: object, sceneId: string) => object | null }} [opts]
 *   start is a test seam; deps go to startAnimation. sceneBlocked says why a
 *   scene's picture is locked (being regenerated, a render running), or null:
 *   a locked scene is left out, and if every scene is locked the one try is
 *   not used up.
 */
export async function autoAnimate(ctx, projectId, { ledgerDir = DATA_DIR, deps, start = startAnimation, sceneBlocked = () => null } = {}) {
  try {
    const project = readProject(ctx.dataDir, projectId);
    if (!project?.aiMotion || project.aiMotion.autoStartedAt) return;
    if (!isSeedanceConfigured()) {
      markStarted(ctx.dataDir, projectId, NOT_CONFIGURED_NOTE);
      return;
    }
    const quality = qualityOf(project.aiMotion.quality);
    const animatable = animatableScenes(project);
    const open = animatable.filter((s) => !sceneBlocked(project, s.id));
    // Every scene is locked: leave the one try for the next images run.
    if (animatable.length && !open.length) return;
    const { picked, total } = pickWithinBudget(project, open, quality, ledgerDir);
    const note = picked.length < total ? BUDGET_NOTE(picked.length, total) : null;
    // Written first: from here on this project never auto-spends again.
    if (!markStarted(ctx.dataDir, projectId, note)) return;
    if (!picked.length) return;
    // Counted before the run starts: its first clips reserve inside start().
    picks.set(projectId, { dataDir: ctx.dataDir, scenes: picked });
    const started = start(ctx, projectId, { sceneIds: picked.map((p) => p.id), quality, ledgerDir, deps });
    if (!started) {
      // A run already holds the project (a manual Animate, or clips being
      // collected after a restart): say so rather than nothing.
      picks.delete(projectId);
      markStarted(ctx.dataDir, projectId, BUSY_NOTE);
    }
  } catch (e) {
    picks.delete(projectId);
    const message = String(e?.message || e);
    console.warn(`[story] auto-animate ${projectId} failed: ${message}`);
    try {
      markStarted(ctx.dataDir, projectId, FAILED_NOTE(message));
    } catch { /* the warning above is all that is left */ }
  }
}
