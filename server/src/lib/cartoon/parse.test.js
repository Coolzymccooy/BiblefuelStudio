import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCartoonScript, MAX_SCRIPT_CHARS } from "./parse.js";

const LOST_LAMB = `# The Lost Lamb
Verse: Luke 15:4
Style: 3D family film

Cast:
- Eli: a shepherd boy about eight, curly dark hair, brown wool tunic, big warm brown eyes. Voice: bright and eager.
- Pip: a small fluffy white lamb with a pink nose and one black ear. Voice: tiny and soft.

Scene: Hillside at dusk, wide
Eli: "Pip? Pip, where are you?"
(Pip bleats from behind a rock.)

Scene: Behind the rock, close-up
Pip: "I'm stuck, Eli!"
Eli: "I've got you. I'll always come for you."
`;

const LINE = "Pip? Pip, where are you?";

function firstLineText(markdown) {
  const parsed = parseCartoonScript(markdown);
  return parsed.scenes[0].beats[0].text;
}

test("MAX_SCRIPT_CHARS is 8000", () => {
  assert.equal(MAX_SCRIPT_CHARS, 8000);
});

test("reads the Lost Lamb sample", () => {
  const parsed = parseCartoonScript(LOST_LAMB);
  assert.equal(parsed.title, "The Lost Lamb");
  assert.equal(parsed.verse, "Luke 15:4");
  assert.equal(parsed.style, "3D family film");
  assert.equal(parsed.cast.length, 2);
  assert.equal(parsed.cast[0].name, "Eli");
  assert.equal(parsed.cast[0].voice, "bright and eager");
  assert.equal(
    parsed.cast[0].look,
    "a shepherd boy about eight, curly dark hair, brown wool tunic, big warm brown eyes",
  );
  assert.equal(parsed.cast[1].name, "Pip");
  assert.equal(parsed.cast[1].voice, "tiny and soft");
  assert.equal(parsed.scenes.length, 2);
  assert.deepEqual(
    parsed.scenes.map((scene) => scene.id),
    ["s1", "s2"],
  );
  assert.equal(parsed.scenes[0].place, "Hillside at dusk");
  assert.equal(parsed.scenes[0].note, "wide");
  assert.equal(parsed.scenes[1].place, "Behind the rock");
  assert.equal(parsed.scenes[1].note, "close-up");
  assert.deepEqual(
    parsed.scenes[0].beats.map((beat) => beat.kind),
    ["line", "action"],
  );
  assert.deepEqual(
    parsed.scenes[1].beats.map((beat) => beat.kind),
    ["line", "line"],
  );
  const beats = parsed.scenes.flatMap((scene) => scene.beats);
  assert.deepEqual(
    beats.map((beat) => (beat.kind === "line" ? `line ${beat.speaker}` : "action")),
    ["line Eli", "action", "line Pip", "line Eli"],
  );
  assert.deepEqual(beats[0], { kind: "line", speaker: "Eli", text: LINE, lineNo: 10 });
  assert.deepEqual(beats[1], { kind: "action", text: "Pip bleats from behind a rock.", lineNo: 11 });
  assert.equal(beats[3].text, "I've got you. I'll always come for you.");
  assert.deepEqual(parsed.ignored, []);
  assert.deepEqual(parsed.warnings, []);
});

test("accepts curly quotes, CRLF, no quotes and ELI:", () => {
  const cast = "Cast:\n- Eli: a boy. Voice: bright.\n\nScene: Hill, wide\n";
  const variants = [
    `${cast}Eli: “${LINE}”\n`,
    `${cast}Eli: "${LINE}"\n`.replace(/\n/g, "\r\n"),
    `${cast}Eli: ${LINE}\n`,
    `${cast}ELI: "${LINE}"\n`,
    `${cast}  Eli :  "  ${LINE}  "  \n`,
  ];
  for (const markdown of variants) {
    assert.equal(firstLineText(markdown), LINE, JSON.stringify(markdown));
  }
});

test("a speaker in another case is stored in the cast spelling", () => {
  const parsed = parseCartoonScript("Cast:\n- Eli: a boy. Voice: bright.\n\nScene: Hill\nELI: \"Hi\"\n");
  assert.equal(parsed.scenes[0].beats[0].speaker, "Eli");
  assert.deepEqual(parsed.warnings, []);
});

test("keeps the spoken text exactly, only stripping the surrounding quotes", () => {
  const parsed = parseCartoonScript(
    "Cast:\n- Eli: a boy.\n\nScene: Hill\nEli: \"He said 'go'  — and \"ran\".\"\n",
  );
  assert.equal(parsed.scenes[0].beats[0].text, "He said 'go'  — and \"ran\".");
});

test("keeps unknown lines in ignored with their line numbers", () => {
  const parsed = parseCartoonScript(
    ["# T", "this line means nothing", "", "Scene: Hill", "Eli: \"Hi\"", "- stray bullet", "# Second title"].join("\n"),
  );
  assert.deepEqual(parsed.ignored, [
    { lineNo: 2, text: "this line means nothing" },
    { lineNo: 6, text: "- stray bullet" },
    { lineNo: 7, text: "# Second title" },
  ]);
  assert.equal(parsed.scenes[0].beats.length, 1);
});

test("a line before any Scene: opens an implicit scene", () => {
  const parsed = parseCartoonScript("Eli: \"Hello?\"\n(He looks around.)\n\nScene: Cave, dark\nEli: \"Echo\"\n");
  assert.equal(parsed.scenes.length, 2);
  assert.deepEqual(
    { id: parsed.scenes[0].id, place: parsed.scenes[0].place, note: parsed.scenes[0].note },
    { id: "s1", place: "", note: "" },
  );
  assert.equal(parsed.scenes[0].beats.length, 2);
  assert.equal(parsed.scenes[1].id, "s2");
  assert.equal(parsed.scenes[1].place, "Cave");
});

test("an unknown speaker is kept and warned about once", () => {
  const parsed = parseCartoonScript(
    "Cast:\n- Eli: a boy.\n\nScene: Hill\nMoses: \"Let my people go.\"\nmoses: \"Again.\"\nEli: \"Who?\"\n",
  );
  assert.equal(parsed.scenes[0].beats.length, 3);
  assert.equal(parsed.scenes[0].beats[0].speaker, "Moses");
  assert.deepEqual(parsed.warnings, ['"Moses" speaks but is not in the Cast list.']);
});

test("defaults: no title, verse, style or voice", () => {
  const parsed = parseCartoonScript("Cast:\n* Eli: a shepherd boy\n- Pip\n\nScene: Hill\nEli: \"Hi\"\n");
  assert.equal(parsed.title, "");
  assert.equal(parsed.verse, "");
  assert.equal(parsed.style, null);
  assert.deepEqual(parsed.cast, [
    { name: "Eli", look: "a shepherd boy", voice: "" },
    { name: "Pip", look: "", voice: "" },
  ]);
});

test("keywords are case-insensitive and Voice: splits at the last occurrence", () => {
  const parsed = parseCartoonScript(
    "VERSE: John 3:16\nstyle: Claymation\ncast:\n- Eli: a boy who loves voice: lessons. VOICE: warm.\nSCENE: Hill, wide, dusk\nEli: \"Hi\"\n",
  );
  assert.equal(parsed.verse, "John 3:16");
  assert.equal(parsed.style, "Claymation");
  assert.deepEqual(parsed.cast[0], { name: "Eli", look: "a boy who loves voice: lessons", voice: "warm" });
  assert.equal(parsed.scenes[0].place, "Hill");
  assert.equal(parsed.scenes[0].note, "wide, dusk");
});

test("empty and non-string input give an empty result", () => {
  for (const input of ["", "   \n\n", undefined, null]) {
    assert.deepEqual(parseCartoonScript(input), {
      title: "",
      verse: "",
      style: null,
      cast: [],
      scenes: [],
      ignored: [],
      warnings: [],
    });
  }
});
