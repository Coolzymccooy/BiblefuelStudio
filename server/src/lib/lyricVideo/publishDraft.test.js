import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPublishDraft, MUSIC_CATEGORY } from "./publishDraft.js";
import { YT_TITLE_MAX, YT_DESCRIPTION_MAX, YT_TAGS_TOTAL_MAX } from "../social/youtubeMetadata.js";

const SHEET = [
  "[VERSE 1]",
  "I planted a seed in the dry ground",
  "",
  "[CHORUS]",
  "Thank God for the seed",
  "If I only have a seed... (PLANT IT!)",
].join("\n");

const project = (over = {}) => ({
  title: "Thank God for the Seed",
  artist: "Sthill Waters",
  sheet: { raw: SHEET },
  sections: [{ id: "s1", kind: "verse", label: "VERSE 1" }, { id: "s2", kind: "chorus", label: "CHORUS" }],
  lines: [
    { id: "l1", sectionId: "s1", kind: "lead", text: "I planted a seed in the dry ground" },
    { id: "l2", sectionId: "s2", kind: "lead", text: "Thank God for the seed" },
    { id: "l3", sectionId: "s2", kind: "lead", text: "If I only have a seed..." },
    { id: "l4", sectionId: "s2", kind: "response", text: "PLANT IT!" },
  ],
  ...over,
});

test("the title names the song and the artist, as an official lyric video", () => {
  assert.equal(buildPublishDraft(project()).title, "Thank God for the Seed — Sthill Waters (Official Lyric Video)");
});

test("with no artist the title leaves the name out", () => {
  assert.equal(buildPublishDraft(project({ artist: "  " })).title, "Thank God for the Seed (Official Lyric Video)");
});

test("a long song title is shortened so the whole title fits YouTube's limit and keeps its ending", () => {
  const draft = buildPublishDraft(project({ title: "A".repeat(140) }));
  assert.ok(draft.title.length <= YT_TITLE_MAX, `got ${draft.title.length}`);
  assert.ok(draft.title.endsWith("— Sthill Waters (Official Lyric Video)"));
});

test("the description credits the artist, quotes the title line, and carries the full lyrics with section labels", () => {
  const d = buildPublishDraft(project()).description;
  assert.ok(d.startsWith("🎵 Song by Sthill Waters"));
  assert.ok(d.includes("“Thank God for the seed”"), "the hook is the line that sings the title");
  assert.ok(d.includes("[VERSE 1]\nI planted a seed in the dry ground\n\n[CHORUS]\nThank God for the seed\nIf I only have a seed... (PLANT IT!)"));
});

test("the hook falls back to the first chorus line when no line sings the title", () => {
  const d = buildPublishDraft(project({ title: "Harvest" })).description;
  assert.ok(d.includes("“Thank God for the seed”"));
});

test("hashtags are built from the title and the artist", () => {
  const d = buildPublishDraft(project()).description;
  assert.match(d, /#LyricVideo #ThankGodForTheSeed #SthillWaters$/);
});

test("angle brackets, which YouTube refuses in a description, are removed", () => {
  const d = buildPublishDraft(project({ sheet: { raw: "[CHORUS]\n<Holy> is the Lord" } })).description;
  assert.ok(!/[<>]/.test(d));
  assert.ok(d.includes("Holy is the Lord"));
});

test("very long lyrics are cut at a line so the description fits, and the hashtags stay", () => {
  const raw = Array.from({ length: 400 }, (_, i) => `This is lyric line number ${i} of a very long song`).join("\n");
  const d = buildPublishDraft(project({ sheet: { raw } })).description;
  assert.ok(d.length <= YT_DESCRIPTION_MAX, `got ${d.length}`);
  assert.match(d, /of a very long song\n…\n\n#LyricVideo/);
});

test("the description fits YouTube's limit in bytes, which accented lyrics fill faster than characters", () => {
  const raw = Array.from({ length: 400 }, () => "Ọlọ́run ṣé o, Ọlọ́run ṣé o, ìyìn fún Ọba").join("\n");
  const d = buildPublishDraft(project({ sheet: { raw } })).description;
  assert.ok(Buffer.byteLength(d, "utf8") <= YT_DESCRIPTION_MAX, `got ${Buffer.byteLength(d, "utf8")} bytes`);
  assert.match(d, /\n…\n\n#LyricVideo/);
});

test("a comma in the title does not split its tag", () => {
  const draft = buildPublishDraft(project({ title: "Hello, World" }));
  assert.ok(draft.tags.every((tag) => !tag.includes(",")));
  assert.equal(draft.tags[0], "Hello World");
});

test("tags are the song, the artist and lyric words, inside YouTube's total", () => {
  const draft = buildPublishDraft(project());
  assert.deepEqual(draft.tags, ["Thank God for the Seed", "Sthill Waters", "Thank God for the Seed lyrics", "lyric video", "lyrics"]);
  const long = buildPublishDraft(project({ title: "word ".repeat(120).trim() }));
  assert.ok(long.tags.join(",").length <= YT_TAGS_TOTAL_MAX);
});

test("the draft is in the Music category and says how to mark altered or synthetic content", () => {
  const draft = buildPublishDraft(project());
  assert.equal(draft.categoryId, MUSIC_CATEGORY);
  assert.equal(MUSIC_CATEGORY, "10");
  assert.match(draft.note, /Altered or synthetic content/);
});

test("an empty sheet still makes a usable draft", () => {
  const draft = buildPublishDraft(project({ sheet: { raw: "" }, lines: [], sections: [], artist: "" }));
  assert.equal(draft.title, "Thank God for the Seed (Official Lyric Video)");
  assert.ok(!draft.description.includes("Song by"));
  assert.match(draft.description, /#LyricVideo #ThankGodForTheSeed$/);
});
