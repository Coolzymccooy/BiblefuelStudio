import { test } from "node:test";
import assert from "node:assert/strict";
import { writeCartoonScript } from "./writer.js";
import { EXAMPLES } from "./examples.js";
import { parseCartoonScript } from "./parse.js";

const LAMB = EXAMPLES[0].markdown;
const LAMB_VERSE = "What man of you, having an hundred sheep, if he lose one of them, doth not leave the ninety and nine in the wilderness, and go after that which is lost, until he find it?";

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

function lookupOk(canonical = "Luke 15:4", text = LAMB_VERSE) {
  const calls = [];
  const fn = async (reference) => {
    calls.push(reference);
    return { ok: true, translation: "kjv", canonical, verses: [{ book: "Luke", chapter: 15, verse: 4, text }], source: "cache" };
  };
  fn.calls = calls;
  return fn;
}

function llmReplies(...replies) {
  const prompts = [];
  const fn = async (prompt) => {
    prompts.push(prompt);
    return replies[Math.min(prompts.length - 1, replies.length - 1)];
  };
  fn.prompts = prompts;
  return fn;
}

const SHORT_FILM = (extra = "") => `# A Test
Verse: whatever
Style: whatever
Cast:
- Eli: a shepherd boy. Voice: bright and eager, a young boy.
- Grandma: an old woman. Voice: low and kind.

Scene: Hillside at dusk, wide
Eli: "Where is my lamb?"
Grandma: "Keep looking, Eli."
${extra}
Scene: Behind the rock, close-up
Eli: "Found you!"
`;

test("returns a script that fits on the first good reply", async () => {
  const llm = llmReplies(LAMB);
  const lookup = lookupOk();
  const result = await writeCartoonScript({ verse: "Luke 15:4" }, { llm, lookup });
  assert.equal(result.ok, true);
  assert.equal(llm.prompts.length, 1);
  assert.deepEqual(lookup.calls, ["Luke 15:4"]);
  assert.equal(result.verseText, LAMB_VERSE);
  assert.equal(parseCartoonScript(result.markdown).verse, "Luke 15:4");
  assert.equal(parseCartoonScript(result.markdown).ignored.length, 0);
});

test("the prompt carries the format example, the rules and the verse text", async () => {
  const llm = llmReplies(LAMB);
  await writeCartoonScript({ verse: "Luke 15:4", style: "storybook", cast: "a boy and his dog" }, { llm, lookup: lookupOk() });
  const prompt = llm.prompts[0];
  assert.ok(prompt.includes("# The Lost Lamb"));
  assert.ok(prompt.includes(LAMB_VERSE));
  assert.ok(prompt.includes("Style: Storybook"));
  assert.ok(prompt.includes("a boy and his dog"));
  assert.ok(prompt.includes("3 speaking characters"));
  assert.ok(prompt.includes("8 shots"));
  assert.ok(prompt.includes("25 words"));
  assert.ok(prompt.includes("34 seconds"));
  assert.ok(!/pixar/i.test(prompt));
});

test("rewrites Verse: to the looked-up reference and Style: to the chosen label", async () => {
  const result = await writeCartoonScript(
    { verse: "luke 15 v4", style: "clay" },
    { llm: llmReplies(SHORT_FILM()), lookup: lookupOk("Luke 15:4") },
  );
  assert.equal(result.ok, true);
  const parsed = parseCartoonScript(result.markdown);
  assert.equal(parsed.verse, "Luke 15:4");
  assert.equal(parsed.style, "Claymation");
});

test("strips a markdown fence around the reply", async () => {
  const fenced = "```markdown\n" + LAMB + "\n```";
  const result = await writeCartoonScript({ verse: "Luke 15:4" }, { llm: llmReplies(fenced), lookup: lookupOk() });
  assert.equal(result.ok, true);
  assert.ok(!result.markdown.includes("```"));
  assert.ok(result.markdown.startsWith("# The Lost Lamb"));
});

test("retries once when the reply is too long, then succeeds", async () => {
  const tooLong = SHORT_FILM(`Grandma: "${words(24)}"\nEli: "${words(24)}"\nGrandma: "${words(24)}"\nEli: "${words(24)}"\nGrandma: "${words(24)}"`);
  const llm = llmReplies(tooLong, LAMB);
  const result = await writeCartoonScript({ verse: "Luke 15:4" }, { llm, lookup: lookupOk() });
  assert.equal(result.ok, true);
  assert.equal(llm.prompts.length, 2);
  assert.ok(llm.prompts[1].includes("too long"));
});

test("a reply with lines the parser cannot place is retried", async () => {
  const llm = llmReplies(`${LAMB}\nthis line is nonsense without a speaker`, LAMB);
  const result = await writeCartoonScript({ verse: "Luke 15:4" }, { llm, lookup: lookupOk() });
  assert.equal(result.ok, true);
  assert.equal(llm.prompts.length, 2);
  assert.ok(llm.prompts[1].includes("this line is nonsense"));
});

test("more than 3 speakers is retried", async () => {
  const four = SHORT_FILM(`Pip: "Baa!"\nMia: "Hello!"`);
  const llm = llmReplies(four, LAMB);
  const result = await writeCartoonScript({ verse: "Luke 15:4" }, { llm, lookup: lookupOk() });
  assert.equal(result.ok, true);
  assert.ok(llm.prompts[1].includes("speaking characters"));
});

test("refuses invented words for Jesus", async () => {
  const invented = SHORT_FILM(`Jesus: "I will always carry you home."`);
  const llm = llmReplies(invented, invented);
  const result = await writeCartoonScript({ verse: "Luke 15:4" }, { llm, lookup: lookupOk() });
  assert.equal(result.ok, false);
  assert.equal(result.code, "WRITE_FAILED");
  assert.equal(llm.prompts.length, 2);
  assert.ok(llm.prompts[1].includes("I will always carry you home"));
});

test("allows Jesus to speak words quoted from the verse", async () => {
  const quoted = SHORT_FILM(`Jesus: "doth not leave the ninety and nine in the wilderness"`);
  const result = await writeCartoonScript({ verse: "Luke 15:4" }, { llm: llmReplies(quoted), lookup: lookupOk() });
  assert.equal(result.ok, true);
});

test("a verse that cannot be found is NO_VERSE", async () => {
  const llm = llmReplies(LAMB);
  const throwing = async () => { throw new Error("Could not parse reference: nope"); };
  const notOk = async () => ({ ok: false, verses: [] });
  for (const lookup of [throwing, notOk]) {
    const result = await writeCartoonScript({ verse: "nope" }, { llm, lookup });
    assert.equal(result.ok, false);
    assert.equal(result.code, "NO_VERSE");
  }
  assert.equal(llm.prompts.length, 0);
});

test("needs a verse or a theme", async () => {
  const result = await writeCartoonScript({}, { llm: llmReplies(LAMB), lookup: lookupOk() });
  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_VERSE");
});

test("a theme alone: the LLM picks a verse, which is looked up and used", async () => {
  const llm = llmReplies(LAMB);
  const lookup = lookupOk("Luke 15:4");
  const result = await writeCartoonScript({ theme: "God never gives up on us" }, { llm, lookup });
  assert.equal(result.ok, true);
  assert.deepEqual(lookup.calls, ["Luke 15:4"]);
  assert.equal(result.verseText, LAMB_VERSE);
  assert.ok(llm.prompts[0].includes("God never gives up on us"));
  assert.ok(/must not speak|no lines/i.test(llm.prompts[0]));
});

test("a theme alone: a Jesus line quoted from the chosen verse is still scripture, so it is accepted", async () => {
  // The prompt asks for no Jesus lines when the writer is choosing the verse,
  // but the check runs against the looked-up text, not against the prompt.
  const quoted = SHORT_FILM(`Jesus: "go after that which is lost"`);
  const result = await writeCartoonScript({ theme: "lost things" }, { llm: llmReplies(quoted), lookup: lookupOk("Luke 15:4") });
  assert.equal(result.ok, true);
});

test("a theme alone: an unfindable chosen verse fails after the retry", async () => {
  const llm = llmReplies(LAMB, LAMB);
  const lookup = async () => { throw new Error("Could not parse reference"); };
  const result = await writeCartoonScript({ theme: "lost things" }, { llm, lookup });
  assert.equal(result.ok, false);
  assert.equal(result.code, "WRITE_FAILED");
  assert.equal(llm.prompts.length, 2);
});

test("a theme alone: a missing Verse line is retried", async () => {
  const noVerse = LAMB.replace(/^Verse:.*\n/m, "");
  const llm = llmReplies(noVerse, LAMB);
  const result = await writeCartoonScript({ theme: "lost things" }, { llm, lookup: lookupOk() });
  assert.equal(result.ok, true);
  assert.equal(llm.prompts.length, 2);
  assert.ok(llm.prompts[1].includes("Verse:"));
});

test("an empty reply or a throwing writer fails after one retry", async () => {
  const empty = llmReplies("", "   ");
  const first = await writeCartoonScript({ verse: "Luke 15:4" }, { llm: empty, lookup: lookupOk() });
  assert.equal(first.code, "WRITE_FAILED");
  assert.equal(empty.prompts.length, 2);
  const boom = async () => { throw new Error("network down"); };
  const second = await writeCartoonScript({ verse: "Luke 15:4" }, { llm: boom, lookup: lookupOk() });
  assert.equal(second.code, "WRITE_FAILED");
});
