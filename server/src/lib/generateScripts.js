import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const CTA_MAP = {
  save: "Save this verse.",
  follow: "Follow @Biblefuel for daily encouragement.",
  share: "Share this with someone who needs it.",
  comment: "Comment 'amen' if you receive it.",
};

const FALLBACK_POOL = [
  { hook: "If today feels heavy, this is for you.", verse: "The Lord is close to the brokenhearted.", reference: "Psalm 34:18", reflection: "You are not alone. God is nearer than you think." },
  { hook: "God has not forgotten you.", verse: "I know the plans I have for you...", reference: "Jeremiah 29:11", reflection: "Delay is not denial. Stay faithful." },
  { hook: "This will calm your anxiety.", verse: "Cast all your anxiety on Him...", reference: "1 Peter 5:7", reflection: "You were never meant to carry it alone." },
  { hook: "Do not scroll. You needed this.", verse: "Be still, and know that I am God.", reference: "Psalm 46:10", reflection: "Rest is an act of trust." },
  { hook: "Take this as your reminder today.", verse: "My grace is sufficient for you.", reference: "2 Corinthians 12:9", reflection: "God's strength shows up right inside your weakness." },
  { hook: "You are not behind God's schedule.", verse: "He has made everything beautiful in its time.", reference: "Ecclesiastes 3:11", reflection: "Trust the process. Heaven is still writing your story." },
  { hook: "Read this before you give up.", verse: "Let us not grow weary in doing good.", reference: "Galatians 6:9", reflection: "Stay planted. Your harvest is coming." },
  { hook: "When fear gets loud, remember this.", verse: "God has not given us a spirit of fear.", reference: "2 Timothy 1:7", reflection: "You were built for courage, not panic." },
  { hook: "This verse carries peace.", verse: "You will keep in perfect peace those whose minds are steadfast.", reference: "Isaiah 26:3", reflection: "Fix your thoughts on God and let your heart settle." },
  { hook: "God sees what nobody else sees.", verse: "Your Father who sees in secret will reward you.", reference: "Matthew 6:6", reflection: "Hidden faithfulness is never wasted." },
  { hook: "You can breathe again.", verse: "Come to me, all who are weary and burdened.", reference: "Matthew 11:28", reflection: "Jesus invites tired hearts to rest, not perform." },
  { hook: "This is your strength verse today.", verse: "Those who hope in the Lord will renew their strength.", reference: "Isaiah 40:31", reflection: "God renews what life drains." },
];

const REFLECTION_VARIANTS = [
  "Take 10 seconds and pray this out loud.",
  "Keep this close and come back to it tonight.",
  "Breathe slowly and let this truth settle.",
  "Carry this into the next part of your day.",
  "Read this again before you sleep.",
  "Share this with one person who needs hope.",
];

function fallbackScripts(count, ctaStyle, startOffset = 0) {
  const cta = CTA_MAP[ctaStyle] || CTA_MAP.save;
  const items = [];
  for (let i = 0; i < count; i++) {
    const template = FALLBACK_POOL[(startOffset + i) % FALLBACK_POOL.length];
    items.push({
      ...template,
      cta,
      title: `Biblefuel Post #${i + 1}`,
      hashtags: ["#faith", "#bible", "#jesus", "#christian", "#encouragement", "#hope"],
    });
  }
  return items;
}

function getHistoryStore() {
  const dir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "scripts_history.json");
}

function loadHistory() {
  try {
    const file = getHistoryStore();
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, "utf-8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  try {
    const file = getHistoryStore();
    fs.writeFileSync(file, JSON.stringify(items.slice(0, 1000), null, 2));
  } catch {
    // ignore
  }
}

function scriptKey(s) {
  return `${(s.hook || "").trim()}|${(s.verse || "").trim()}|${(s.reference || "").trim()}|${(s.reflection || "").trim()}|${(s.cta || "").trim()}`.toLowerCase();
}

function dedupeScripts(list, existingKeys) {
  const out = [];
  for (const s of list) {
    const key = scriptKey(s);
    if (!key || existingKeys.has(key)) continue;
    existingKeys.add(key);
    out.push(s);
  }
  return out;
}

function finalizeScripts({ preferred, count, ctaStyle, historyKeys }) {
  let out = dedupeScripts(preferred || [], historyKeys);
  if (out.length < count) {
    const seed = (historyKeys.size * 13 + Math.floor(Date.now() / 60000)) % FALLBACK_POOL.length;
    const fallback = fallbackScripts(Math.max(count * 8, FALLBACK_POOL.length), ctaStyle, seed);
    out = out.concat(dedupeScripts(fallback, historyKeys));
  }

  // If history is exhausted, allow fallback reuse so count is always satisfied.
  if (out.length < count) {
    let attempt = 0;
    while (out.length < count && attempt < count * 40) {
      const base = FALLBACK_POOL[(historyKeys.size + attempt) % FALLBACK_POOL.length];
      const extra = REFLECTION_VARIANTS[(historyKeys.size + attempt) % REFLECTION_VARIANTS.length];
      const remixed = {
        ...base,
        reflection: `${base.reflection} ${extra}`,
        cta: CTA_MAP[ctaStyle] || CTA_MAP.save,
        title: `Biblefuel Post #${out.length + 1}`,
        hashtags: ["#faith", "#bible", "#jesus", "#christian", "#encouragement", "#hope"],
      };
      const add = dedupeScripts([remixed], historyKeys);
      if (add.length) out.push(add[0]);
      attempt += 1;
    }
  }

  return out.slice(0, count).map((s, i) => ({
    ...s,
    title: s.title || `Biblefuel Post #${i + 1}`,
    hashtags: Array.isArray(s.hashtags) && s.hashtags.length ? s.hashtags : ["#faith", "#bible", "#jesus", "#christian", "#encouragement", "#hope"],
  }));
}

async function openaiGenerate(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.startsWith("your-")) return null;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9,
      }),
    });
    if (!resp.ok) {
      console.error(`OpenAI Error: ${resp.status} ${await resp.text()}`);
      return null;
    }
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    console.error("OpenAI Fetch Error:", err);
    return null;
  }
}

async function geminiGenerate(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.startsWith("your-")) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9 },
      }),
    });
    if (!resp.ok) {
      console.error(`Gemini Error: ${resp.status} ${await resp.text()}`);
      return null;
    }
    const data = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  } catch (err) {
    console.error("Gemini Fetch Error:", err);
    return null;
  }
}

export async function generateScripts({ niche, tone, count, lengthSeconds, includeVerseReference, ctaStyle }) {
  const schema = {
    type: "array",
    items: {
      type: "object",
      properties: {
        title: { type: "string" },
        hook: { type: "string" },
        verse: { type: "string" },
        reference: { type: "string" },
        reflection: { type: "string" },
        cta: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
      },
      required: ["title", "hook", "verse", "reflection", "cta", "hashtags"],
    },
  };

  const prompt = `
Generate ${count} UNIQUE faceless TikTok scripts for Bible content.
Niche: ${niche}
Tone: ${tone}
Target length: ${lengthSeconds}s each
Rules:
- Hook: 1 short sentence.
- Verse: short (paraphrase ok).
- Reference: ${includeVerseReference ? "include a real Bible reference" : "leave empty string"}.
- Reflection: 1-2 short sentences.
- CTA style: ${ctaStyle}
- Include 6-10 hashtags.
- Return ONLY valid JSON array.
Schema:
${JSON.stringify(schema)}
`;

  const history = loadHistory();
  const historyKeys = new Set(history);

  let raw = await geminiGenerate(prompt);
  if (!raw) raw = await openaiGenerate(prompt);

  if (!raw) {
    const scripts = finalizeScripts({ preferred: [], count, ctaStyle, historyKeys });
    saveHistory([...historyKeys]);
    return scripts;
  }

  const firstBracket = raw.indexOf("[");
  const lastBracket = raw.lastIndexOf("]");
  if (firstBracket === -1 || lastBracket === -1) {
    const scripts = finalizeScripts({ preferred: [], count, ctaStyle, historyKeys });
    saveHistory([...historyKeys]);
    return scripts;
  }

  const jsonText = raw.slice(firstBracket, lastBracket + 1);
  try {
    const parsed = JSON.parse(jsonText);
    const list = Array.isArray(parsed) ? parsed : [];
    const normalized = list.map((x, i) => ({
      title: String(x?.title || `Biblefuel Post #${i + 1}`).trim(),
      hook: String(x?.hook || "").trim(),
      verse: String(x?.verse || "").trim(),
      reference: includeVerseReference ? String(x?.reference || "").trim() : "",
      reflection: String(x?.reflection || "").trim(),
      cta: String(x?.cta || CTA_MAP[ctaStyle] || CTA_MAP.save).trim(),
      hashtags: Array.isArray(x?.hashtags) ? x.hashtags.map((h) => String(h || "").trim()).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`)) : [],
    })).filter((x) => x.hook && x.verse && x.reflection);

    const scripts = finalizeScripts({ preferred: normalized, count, ctaStyle, historyKeys });
    saveHistory([...historyKeys]);
    return scripts;
  } catch {
    const scripts = finalizeScripts({ preferred: [], count, ctaStyle, historyKeys });
    saveHistory([...historyKeys]);
    return scripts;
  }
}
