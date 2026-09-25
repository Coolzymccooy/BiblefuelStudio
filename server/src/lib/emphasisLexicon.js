// Semantic emphasis lexicon. Deterministic, no I/O. Replaces the purely
// length-based keyword heuristic (captions.js pickKeyword) with categorized
// scripture/emotion word weights so the annotation layer can choose a "hero"
// word per phrase. Unknown words score 0, which preserves the longest-word
// fallback downstream.
//
// Designed so an optional LLM scorer can later slot in behind the same
// `scoreWord` contract without changing callers.

// Category → weight. Higher = more emphasis. Deity/person names carry the most
// weight, hope words next, action/fear share the dramatic mid band.
const CATEGORY_WEIGHTS = Object.freeze({
  deity: 5,
  hope: 4,
  action: 3,
  fear: 3,
});

// Each set holds canonical, lowercased, apostrophe-free entries. Matching is
// exact on the normalized token (see normalize), so possessives like "god's"
// do not match "god" — that is intentional: emphasis tracks the bare keyword.
const CATEGORY_WORDS = Object.freeze({
  deity: new Set([
    "lord", "god", "jesus", "christ", "spirit", "father", "shepherd",
    "king", "almighty", "savior", "saviour", "redeemer", "messiah", "yahweh",
  ]),
  hope: new Set([
    "mercy", "grace", "peace", "hope", "love", "faith", "joy", "glory",
    "victory", "saved", "blessed", "blessing", "salvation", "forgiven",
    "healed", "restored", "promise", "light", "freedom", "alive",
  ]),
  action: new Set([
    "rise", "arise", "fight", "run", "follow", "conquer", "overcome",
    "stand", "pursue", "press", "march", "build", "move", "awaken",
  ]),
  fear: new Set([
    "fear", "death", "evil", "darkness", "sin", "lost", "fall", "enemy",
    "trouble", "storm", "shadow", "grave", "chains", "broken",
  ]),
});

// Mirror captions.js tokenization: strip everything that is not a word char
// (letters, digits, apostrophe), then lowercase. A token like "Lord," → "lord".
function normalize(token) {
  return String(token ?? "")
    .replace(/[^A-Za-z0-9']/g, "")
    .toLowerCase();
}

/**
 * Return the lexicon category a token belongs to, or null.
 *
 * @param {string} token
 * @returns {"deity" | "hope" | "action" | "fear" | null}
 */
export function categoryOf(token) {
  const word = normalize(token);
  if (!word) return null;
  for (const category of Object.keys(CATEGORY_WORDS)) {
    if (CATEGORY_WORDS[category].has(word)) return category;
  }
  return null;
}

/**
 * Emphasis weight for a token. Lexicon hit → its category weight, else 0.
 *
 * @param {string} token
 * @returns {number}
 */
export function scoreWord(token) {
  const category = categoryOf(token);
  return category ? CATEGORY_WEIGHTS[category] : 0;
}
