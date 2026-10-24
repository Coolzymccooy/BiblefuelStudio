/**
 * The short orientation an MCP client gives its model at initialize, before any
 * tool is called. Agent runs (slice 5) showed why it is needed: without it one
 * agent answered a verse request from a web search instead of bible_lookup, and
 * the full guide (about 70 KB) is too long for most clients to read whole.
 * Keep it short; the guide holds the detail.
 */
export const SERVER_INSTRUCTIONS = [
  "BibleFuel Studio makes Bible videos for the key's owner: short verse videos, story videos, ambient scripture sessions, lyric videos, Moments photo videos, timelines and series.",
  "Call whoami first: it shows the plan, what is left of the plan quota and of this key's daily caps, and whether this key may publish.",
  "Use bible_lookup for the text of a verse (free) rather than the web.",
  "Slow work returns a job handle at once: call jobs_wait with its kind and id, and again while it is queued or running.",
  "Pass voice_list a locale, such as en, to keep its answer short.",
  "capabilities says what the server has configured, not what this key may use: tools/list and whoami say that.",
  "Nothing is posted unless the key may publish and the user asks for it or has auto-publish on (then a render posts by itself): check social_status before rendering.",
  "The full guide, with every pipeline and what each step costs, is the resource biblefuel://guide. It is long: read the Pipelines section you need.",
].join(" ");
