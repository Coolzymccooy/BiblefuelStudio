import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { hasLibass } from "./capability.js";
import { studioCaptionFilter } from "./filter.js";
import { widthAt } from "./text.js";
import { LOOKS, FALLBACK_FONT } from "./looks.js";

const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const skip = hasLibass() ? false : "ffmpeg here has no libass";

/** Render one frame at time t of a w×h black clip with the captions, as greyscale or rgb24 bytes. */
function frameAt({ assText, w, h, t, pix = "rgb24" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinetic-"));
  const assPath = path.join(dir, "c.ass");
  // The filter string comes from production code (same escaping); the file
  // it reads holds this test's own document.
  const { filter } = studioCaptionFilter({ assPath, words: [{ text: "x", start: 0, end: 1 }], w, h });
  fs.writeFileSync(assPath, assText);
  const out = execFileSync(ff, ["-v", "error", "-f", "lavfi", "-i", `color=black:s=${w}x${h}:d=${t + 1}:r=25`,
    "-vf", filter, "-ss", String(t), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", pix, "pipe:1"],
    { maxBuffer: 64 * 1024 * 1024 });
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

test("each look's fonts load by family name, not a system substitute", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinetic-"));
  const faces = [...new Set(Object.values(LOOKS).flatMap((l) => [l.body, l.hit]).concat([FALLBACK_FONT]).map((f) => f.family))];
  const events = faces.map((fam, i) => `Dialogue: 0,0:00:00.00,0:00:01.00,Kinetic,,0,0,0,,{\\an5\\pos(640,${60 + i * 80})\\fn${fam}}TEST`).join("\n");
  const assPath = path.join(dir, "fonts.ass");
  fs.writeFileSync(assPath, `[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Kinetic,DejaVu Sans,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,5,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`);
  const { filter } = studioCaptionFilter({ assPath, words: [{ text: "x", start: 0, end: 1 }], w: 1280, h: 720 });
  const r = spawnSync(ff, ["-hide_banner", "-v", "info", "-f", "lavfi", "-i", "color=black:s=1280x720:d=0.2", "-vf", filter, "-f", "null", "-"], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  for (const fam of faces) {
    const line = r.stderr.split("\n").find((l) => l.includes(`fontselect: (${fam},`));
    assert.ok(line, `no fontselect line for ${fam}`);
    const chosen = line.split("->")[1].trim().split(",")[0].toLowerCase().replace(/[^a-z]/g, "");
    assert.ok(chosen.startsWith(fam.toLowerCase().replace(/[^a-z]/g, "")), `${fam} resolved to ${chosen}`);
  }
});

test("drawn width matches the engine's measurement within 6%", { skip }, () => {
  for (const face of [LOOKS["lagos-night"].body, LOOKS["lagos-night"].hit, LOOKS["gospel-gold"].hit]) {
    const text = "MMMMMMMM";
    const assText = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Kinetic,${face.family},100,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:05.00,Kinetic,,0,0,0,,{\\an5\\pos(640,360)}${text}\n`;
    const buf = frameAt({ assText, w: 1280, h: 720, t: 0.5, pix: "gray" });
    let minX = 1280, maxX = -1;
    for (let y = 0; y < 720; y += 1) for (let x = 0; x < 1280; x += 1) {
      if (buf[y * 1280 + x] > 60) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
    const ink = maxX - minX + 1;
    const measured = widthAt(face.file, text, 100);
    assert.ok(Math.abs(ink - measured) / measured <= 0.06, `${face.family}: ink ${ink}px vs measured ${measured.toFixed(1)}px`);
  }
});

test("a slam paints the hit colour at the centre while it is up, and nothing before the first word", { skip }, () => {
  const words = [{ text: "I", start: 1.0, end: 1.2 }, { text: "still", start: 1.2, end: 1.5 }, { text: "dey", start: 1.5, end: 1.9 }];
  const out = studioCaptionFilter({ assPath: "unused", words, w: 1280, h: 720, look: "studio-lagos-night", energy: "calm", seed: 1, overrides: { 0: "slam" } });
  const assText = out.sideFiles[0].text;
  const yellow = (buf) => {
    let n = 0;
    for (let y = 200; y < 460; y += 2) for (let x = 200; x < 1080; x += 2) {
      const i = (y * 1280 + x) * 3;
      if (buf[i] > 200 && buf[i + 1] > 170 && buf[i + 2] < 120) n += 1;
    }
    return n;
  };
  assert.equal(yellow(frameAt({ assText, w: 1280, h: 720, t: 0.5 })), 0, "nothing before the first word");
  assert.ok(yellow(frameAt({ assText, w: 1280, h: 720, t: 1.8 })) > 500, "yellow slam on screen");
});
