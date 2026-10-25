import { test } from "node:test";
import assert from "node:assert/strict";
import { directMoment } from "./director.js";
import { beatGridOf, pulseGrid } from "./cuts.js";
import { validatePlan } from "./plan.js";
import { shotGraph } from "./shotArgs.js";
import { finishArgs } from "./finish.js";
import { FFMPEG_51_FILTERS } from "./effects/index.js";
import { filterNames } from "./testkit.js";
import { CLASSIC_IDS } from "./styles.js";

/**
 * The guard between the director and the renderer: whatever plan the director
 * makes, every graph the renderer builds from it uses only filters that exist
 * in the production ffmpeg (5.1), and wires every label up exactly once.
 */
const LABEL = /\[[^\]]+\]/g;
const INPUT_PAD = /^\[\d+:[va]\]$/;

/** Single quotes hold expression text (commas, brackets); drop them before reading labels. */
function unquoted(text) {
  let out = "";
  let quoted = false;
  for (const ch of text) {
    if (ch === "'") quoted = !quoted;
    else if (!quoted) out += ch;
  }
  return out;
}

/** Problems with one filtergraph script: unknown filters, and labels not made once or not used once. */
export function graphProblems(script, who) {
  const problems = [];
  for (const name of filterNames(script.split(";"))) {
    if (!FFMPEG_51_FILTERS.has(name)) problems.push(`${who}: filter "${name}" is not in the ffmpeg 5.1 list`);
  }
  const made = new Map();
  const used = new Map();
  for (const raw of script.split(";")) {
    const st = unquoted(raw).trim();
    if (!st) continue;
    for (const l of st.match(new RegExp(`^(?:${LABEL.source})+`))?.[0].match(LABEL) ?? []) used.set(l, (used.get(l) ?? 0) + 1);
    for (const l of st.match(new RegExp(`(?:${LABEL.source})+$`))?.[0].match(LABEL) ?? []) made.set(l, (made.get(l) ?? 0) + 1);
  }
  for (const [l, n] of made) {
    if (n > 1) problems.push(`${who}: ${l} is made ${n} times`);
    if (!used.has(l) && l !== "[v]" && l !== "[a]") problems.push(`${who}: ${l} is made but never used`);
  }
  for (const [l, n] of used) {
    if (n > 1) problems.push(`${who}: ${l} is used ${n} times`);
    if (!made.has(l) && !INPUT_PAD.test(l)) problems.push(`${who}: ${l} is used but never made`);
  }
  return problems;
}

function grid(len, step) {
  const beats = [];
  for (let t = 0.2; t < len; t += step) beats.push(Math.round(t * 1000) / 1000);
  return beatGridOf({ beats, downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0), strong: [8, 16, 40], period: step });
}

const MIXES = {
  tall: ["tall", "tall", "tall", "tall"],
  mixed: ["wide", "tall", "wide", "tall", "tall"],
};
const AUDIO = [
  { song: null, voice: null },
  { song: { file: "song.mp3", startSec: 1 }, voice: null },
  { song: null, voice: { file: "voice.mp3" } },
  { song: { file: "song.mp3", startSec: 1 }, voice: { file: "voice.mp3" } },
];

test("graphProblems itself catches an unknown filter and a mis-wired label", () => {
  assert.deepEqual(graphProblems("[0:v]scale=10:10[q];[q]format=yuv420p[v]", "ok"), []);
  assert.match(graphProblems("[0:v]nosuchfilter[v]", "x")[0], /nosuchfilter/);
  assert.match(graphProblems("[0:v]scale=1:1[q];[0:v]scale=2:2[q];[q]null[v]", "x").join("|"), /\[q\] is made 2 times/);
  assert.match(graphProblems("[0:v]scale=1:1[q];[b]null[v]", "x").join("|"), /\[q\] is made but never used/);
  assert.match(graphProblems("[0:v]scale=1:1[q];[q]null[b];[q]null[v]", "x").join("|"), /\[q\] is used 2 times/);
  assert.match(graphProblems("[b]null[v]", "x")[0], /used but never made/);
});

test("every plan the director makes builds shot and finish graphs on ffmpeg 5.1 filters with every label wired once", () => {
  let plans = 0;
  let shotGraphs = 0;
  const problems = [];
  for (const seed of [3, 11, 42]) {
    for (const styleId of CLASSIC_IDS) {
      for (const energy of [0.1, 0.5, 0.95]) {
        for (const lengthSec of [15, 30]) {
          for (const [mixName, shapes] of Object.entries(MIXES)) {
            const grids = [grid(lengthSec, 0.5), pulseGrid(lengthSec)];
            const g = grids[(seed + plans) % 2];
            const photos = shapes.map((shape) => ({ shape }));
            const { plan } = directMoment({
              photos, heroIndex: 1, grid: g, title: "Happy birthday Mum",
              statements: ["Grace upon grace", "Still rising", "Celebrate!"], styleId, energy, lengthSec, seed,
            });
            plans += 1;
            const label = `${mixName} ${styleId}@${energy} ${lengthSec}s seed ${seed}`;
            const valid = validatePlan(plan, { photoCount: photos.length, shapes });
            assert.equal(valid.ok, true, `${label}: ${JSON.stringify(valid.errors)}`);
            plan.shots.forEach((shot, i) => {
              const hasPrev = i > 0 && shot.entrance.id === "crossfade";
              const text = shotGraph({ shot, w: plan.w, h: plan.h, fps: plan.fps, hasPrev });
              shotGraphs += 1;
              problems.push(...graphProblems(text, `${label} shot ${i} (${shot.move.id}/${shot.entrance.id})`));
            });
            const audio = AUDIO[plans % AUDIO.length];
            const { sideFiles } = finishArgs({
              body: "body.mp4", out: "final.mp4", plan, statementsPath: "statements.ass", fxPath: "fx.ass", ...audio, workDir: "work",
            });
            for (const f of sideFiles) problems.push(...graphProblems(f.text, `${label} ${f.path.split(/[\\/]/).pop()}`));
          }
        }
      }
    }
  }
  assert.ok(plans >= 140 && shotGraphs > 1000, `swept ${plans} plans and ${shotGraphs} shot graphs`);
  assert.deepEqual(problems.slice(0, 10), []);
});

test("all four audio arrangements of the finish are wired and on allowed filters", () => {
  const { plan } = directMoment({
    photos: [{ shape: "tall" }, { shape: "tall" }, { shape: "tall" }], heroIndex: 0, grid: grid(15, 0.5), title: "T",
    statements: ["a", "b", "c"], styleId: "glow", energy: 0.5, lengthSec: 15, seed: 5,
  });
  for (const audio of AUDIO) {
    const { sideFiles } = finishArgs({ body: "b.mp4", out: "o.mp4", plan, statementsPath: "s.ass", fxPath: null, ...audio, workDir: "w" });
    assert.equal(sideFiles.length, 2);
    for (const f of sideFiles) assert.deepEqual(graphProblems(f.text, f.path), [], f.text);
  }
});
