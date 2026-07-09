import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";
import { sanitizeScriptObject } from "./speakableScript.js";

const CTA_MAP = {
  save: "Save this verse.",
  follow: "Follow @Biblefuel for daily encouragement.",
  share: "Share this with someone who needs it.",
  comment: "Comment 'amen' if you receive it.",
};

const SCRIPT_TYPES = {
  peace: "peace in storms, rest, calm, God's presence, trust when life feels heavy",
  strength: "spiritual strength, battles, endurance, courage, God's power in weakness",
  anxiety: "anxiety, fear, worry, overthinking, casting burdens on God",
  identity: "identity in Christ, image of God, chosen, loved, purpose, confidence in Him",
  prayer: "prayer, waiting, persistence, God hears, faith while answers are delayed",
  gratitude: "gratitude, daily mercy, contentment, joy, remembering God's goodness",
  forgiveness: "forgiveness, grace, mercy, release from guilt, starting again",
  purpose: "calling, direction, destiny, using gifts, walking with God",
  healing: "healing, grief, brokenness, restoration, God near to wounded hearts",
  custom: "the user's custom prompt",
};

const SCRIPT_TYPE_TITLES = {
  peace: "Peace in the Storm",
  strength: "Strength for the Battle",
  anxiety: "Faith Over Fear",
  identity: "Created in His Image",
  prayer: "Keep Praying",
  gratitude: "Mercy Every Morning",
  forgiveness: "Grace to Begin Again",
  purpose: "Made for Purpose",
  healing: "Healing for the Heart",
  custom: "Biblefuel Post",
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
  // Expanded set so the dedup pool doesn't exhaust after a few weeks of daily auto-publish.
  { hook: "Joy is on the way.", verse: "Weeping may stay for the night, but rejoicing comes in the morning.", reference: "Psalm 30:5", reflection: "The dark season is a chapter, not the whole story." },
  { hook: "He is fighting for you right now.", verse: "The Lord will fight for you; you need only to be still.", reference: "Exodus 14:14", reflection: "Some battles you win by trusting, not striving." },
  { hook: "Your prayers are not wasted.", verse: "The prayer of a righteous person is powerful and effective.", reference: "James 5:16", reflection: "Heaven hears every whispered word." },
  { hook: "Grace meets you exactly here.", verse: "Let us approach God's throne of grace with confidence.", reference: "Hebrews 4:16", reflection: "Come as you are. Mercy is already waiting." },
  { hook: "You are deeply loved.", verse: "I have loved you with an everlasting love.", reference: "Jeremiah 31:3", reflection: "Nothing you did earned it. Nothing you do can lose it." },
  { hook: "Hold on. He is not done.", verse: "He who began a good work in you will carry it on to completion.", reference: "Philippians 1:6", reflection: "Your unfinished story is still in faithful hands." },
  { hook: "You were chosen on purpose.", verse: "You are a chosen people, a royal priesthood, a holy nation.", reference: "1 Peter 2:9", reflection: "Walk in the identity God already gave you." },
  { hook: "Stop carrying what was never yours.", verse: "Take my yoke upon you, for my yoke is easy and my burden is light.", reference: "Matthew 11:29-30", reflection: "Surrender is strength, not defeat." },
  { hook: "God's plan is better than your plan.", verse: "For my thoughts are not your thoughts, neither are your ways my ways.", reference: "Isaiah 55:8", reflection: "Detours from heaven are still going somewhere good." },
  { hook: "You are stronger than you feel today.", verse: "I can do all this through him who gives me strength.", reference: "Philippians 4:13", reflection: "Strength shows up the moment you take the next step." },
  { hook: "He is making something new.", verse: "See, I am doing a new thing! Now it springs up; do you not perceive it?", reference: "Isaiah 43:19", reflection: "What feels like an ending is often a beginning." },
  { hook: "Trust the One who never moves.", verse: "Jesus Christ is the same yesterday and today and forever.", reference: "Hebrews 13:8", reflection: "When everything shifts, He doesn't." },
  { hook: "Stop apologizing for needing rest.", verse: "He makes me lie down in green pastures, he leads me beside quiet waters.", reference: "Psalm 23:2", reflection: "Rest is part of the assignment." },
  { hook: "Run to Him before you run anywhere else.", verse: "Seek first the kingdom of God and his righteousness.", reference: "Matthew 6:33", reflection: "Order matters. Put God first and the rest sorts itself out." },
  { hook: "God remembers what you forgot.", verse: "He remembers his covenant forever.", reference: "Psalm 105:8", reflection: "Heaven keeps a longer memory of your faith than you do." },
  { hook: "Your worship moves Heaven.", verse: "The Father is seeking such people to worship him.", reference: "John 4:23", reflection: "Worship isn't a performance. It's a posture." },
  { hook: "You are not invisible to God.", verse: "You are the God who sees me.", reference: "Genesis 16:13", reflection: "He sees you, names you, and stays with you." },
  { hook: "He is closer than your next breath.", verse: "The Lord is near to all who call on him.", reference: "Psalm 145:18", reflection: "No journey required. He's already here." },
  { hook: "Even on your worst day, He is faithful.", verse: "If we are faithless, he remains faithful.", reference: "2 Timothy 2:13", reflection: "Your shaky faith doesn't shake His." },
  { hook: "His mercy is brand new today.", verse: "His mercies are new every morning.", reference: "Lamentations 3:23", reflection: "Yesterday's failure is not today's identity." },
  { hook: "You are walking with purpose.", verse: "In all things God works for the good of those who love him.", reference: "Romans 8:28", reflection: "Even the hard chapters are working for you." },
  { hook: "Lay it down. He's strong enough.", verse: "Humble yourselves under God's mighty hand, that he may lift you up.", reference: "1 Peter 5:6", reflection: "Surrender is the doorway to elevation." },
  { hook: "Speak life over your situation.", verse: "Death and life are in the power of the tongue.", reference: "Proverbs 18:21", reflection: "Stop rehearsing what scares you. Rehearse what He said." },
  { hook: "God is in the waiting room with you.", verse: "Wait for the Lord; be strong and take heart.", reference: "Psalm 27:14", reflection: "Waiting is not wasted when He is the company." },
  { hook: "The Spirit is praying for you.", verse: "The Spirit himself intercedes for us through wordless groans.", reference: "Romans 8:26", reflection: "When you have no words, Heaven still has voice." },
  { hook: "He is preparing room for you.", verse: "I am going there to prepare a place for you.", reference: "John 14:2", reflection: "Your future is already being built." },
  { hook: "You don't have to figure it all out.", verse: "Trust in the Lord with all your heart and lean not on your own understanding.", reference: "Proverbs 3:5", reflection: "Confusion isn't disqualification. Trust still gets you there." },
];

const REFLECTION_VARIANTS = [
  "Take 10 seconds and pray this out loud.",
  "Keep this close and come back to it tonight.",
  "Breathe slowly and let this truth settle.",
  "Carry this into the next part of your day.",
  "Read this again before you sleep.",
  "Share this with one person who needs hope.",
  "Write this on a sticky note where you'll see it.",
  "Whisper it back to God in your own words.",
  "Let this be your anchor when the day shifts.",
  "Receive it. You don't have to earn it.",
  "Rest in this for thirty seconds before moving on.",
  "Speak this out loud the next time fear knocks.",
];

function chooseFallbackPool(scriptType = "peace") {
  const needles = {
    peace: ["peace", "rest", "still", "breathe", "waters"],
    strength: ["strength", "battle", "fight", "strong", "courage"],
    anxiety: ["anxiety", "fear", "worry", "panic"],
    identity: ["chosen", "loved", "identity", "purpose", "image"],
    prayer: ["prayer", "pray", "hears", "waiting"],
    gratitude: ["mercy", "joy", "morning", "goodness"],
    forgiveness: ["grace", "mercy", "failure", "surrender"],
    purpose: ["purpose", "plan", "chosen", "works for the good"],
    healing: ["broken", "healing", "wounded", "restoration"],
  }[scriptType] || [];
  if (!needles.length) return FALLBACK_POOL;
  const scored = FALLBACK_POOL.filter((item) => {
    const hay = `${item.hook} ${item.verse} ${item.reference} ${item.reflection}`.toLowerCase();
    return needles.some((n) => hay.includes(n));
  });
  return scored.length ? scored : FALLBACK_POOL;
}

function fallbackScripts(count, ctaStyle, startOffset = 0, scriptType = "peace") {
  const pool = chooseFallbackPool(scriptType);
  const cta = CTA_MAP[ctaStyle] || CTA_MAP.save;
  const items = [];
  for (let i = 0; i < count; i++) {
    const template = pool[(startOffset + i) % pool.length];
    items.push(sanitizeScriptObject({
      ...template,
      cta,
      title: `${SCRIPT_TYPE_TITLES[scriptType] || "Biblefuel Post"} #${i + 1}`,
      hashtags: ["#faith", "#bible", "#jesus", "#christian", "#encouragement", "#hope"],
    }));
  }
  return items;
}

function getHistoryStore() {
  const dir = DATA_DIR;
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

function finalizeScripts({ preferred, count, ctaStyle, historyKeys, scriptType = "peace" }) {
  let out = dedupeScripts(preferred || [], historyKeys);
  if (out.length < count) {
    const seed = (historyKeys.size * 13 + Math.floor(Date.now() / 60000)) % FALLBACK_POOL.length;
    const fallback = fallbackScripts(Math.max(count * 8, FALLBACK_POOL.length), ctaStyle, seed, scriptType);
    out = out.concat(dedupeScripts(fallback, historyKeys));
  }

  // If history is exhausted, allow fallback reuse so count is always satisfied.
  if (out.length < count) {
    let attempt = 0;
    while (out.length < count && attempt < count * 40) {
      const remixPool = chooseFallbackPool(scriptType);
      const base = remixPool[(historyKeys.size + attempt) % remixPool.length];
      const extra = REFLECTION_VARIANTS[(historyKeys.size + attempt) % REFLECTION_VARIANTS.length];
      const remixed = {
        ...base,
        reflection: `${base.reflection} ${extra}`,
        cta: CTA_MAP[ctaStyle] || CTA_MAP.save,
        title: `${SCRIPT_TYPE_TITLES[scriptType] || "Biblefuel Post"} #${out.length + 1}`,
        hashtags: ["#faith", "#bible", "#jesus", "#christian", "#encouragement", "#hope"],
      };
      const add = dedupeScripts([remixed], historyKeys);
      if (add.length) out.push(add[0]);
      attempt += 1;
    }
  }

  // Final safety net: history may have absorbed every remix combination too.
  // Force-yield raw fallback templates with timestamped titles so the API
  // never returns 0 scripts when the user explicitly asked for >= 1.
  if (out.length < count) {
    const totalCombos = FALLBACK_POOL.length * REFLECTION_VARIANTS.length;
    console.warn(
      `[SCRIPTS] dedup exhausted — history has ${historyKeys.size} keys; ` +
      `pool exposes ~${totalCombos} unique combinations. Forcing safety-net ` +
      `fallback yield to satisfy count=${count}. ` +
      `Set a real LLM key (OPENAI_API_KEY / GEMINI_API_KEY) or clear data/scripts_history.json to reset.`
    );
    const cta = CTA_MAP[ctaStyle] || CTA_MAP.save;
    const ts = Date.now();
    let i = 0;
    while (out.length < count) {
      const safetyPool = chooseFallbackPool(scriptType);
      const base = safetyPool[(out.length + i) % safetyPool.length];
      out.push({
        ...base,
        cta,
        title: `${SCRIPT_TYPE_TITLES[scriptType] || "Biblefuel Post"} #${out.length + 1}`,
        hashtags: ["#faith", "#bible", "#jesus", "#christian", "#encouragement", "#hope"],
        _stamp: ts + i,
      });
      i += 1;
    }
  }

  return out.slice(0, count).map((s, i) => {
    const { _stamp, ...clean } = s;
    return sanitizeScriptObject({
      ...clean,
      title: clean.title || `${SCRIPT_TYPE_TITLES[scriptType] || "Biblefuel Post"} #${i + 1}`,
      hashtags: Array.isArray(clean.hashtags) && clean.hashtags.length ? clean.hashtags : ["#faith", "#bible", "#jesus", "#christian", "#encouragement", "#hope"],
    });
  });
}

async function opencodeGenerate(prompt) {
  // Feature flag — opencode integration is parked until the free-tier story
  // is settled (MiniMax direct = paid; opencode Zen / OpenRouter free require
  // a switch). Flip OPENCODE_ENABLED=true once the provider has been chosen
  // in deploy/opencode/opencode.json.
  if (String(process.env.OPENCODE_ENABLED || "").toLowerCase() !== "true") return null;
  const base = String(process.env.OPENCODE_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return null;
  const password = process.env.OPENCODE_SERVER_PASSWORD || "";
  const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
  const model = process.env.OPENCODE_MODEL || undefined;
  const agent = process.env.OPENCODE_AGENT || undefined;
  const pollMs = Number(process.env.OPENCODE_POLL_MS || 1500);
  const maxWaitMs = Number(process.env.OPENCODE_MAX_WAIT_MS || 60000);

  const headers = { "Content-Type": "application/json" };
  if (password) {
    const token = Buffer.from(`${username}:${password}`).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }

  const extractAssistantText = (payload) => {
    // Accept several shapes: { parts }, { info, parts }, or a list of messages
    const collect = (parts) => Array.isArray(parts)
      ? parts
        .filter((p) => p && p.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("")
      : "";
    if (Array.isArray(payload)) {
      // Assume a list of messages — pick the most recent assistant reply
      for (let i = payload.length - 1; i >= 0; i--) {
        const m = payload[i];
        const role = m?.info?.role || m?.role;
        if (role === "assistant") {
          const text = collect(m?.parts);
          if (text) return text;
        }
      }
      return "";
    }
    return collect(payload?.parts);
  };

  try {
    const sessionResp = await fetch(`${base}/session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "biblefuel-script" }),
    });
    if (!sessionResp.ok) {
      console.error(`OpenCode session error: ${sessionResp.status} ${await sessionResp.text()}`);
      return null;
    }
    const session = await sessionResp.json();
    const sessionId = session?.id || session?.info?.id;
    if (!sessionId) {
      console.error("OpenCode session response missing id", session);
      return null;
    }

    const messageBody = { parts: [{ type: "text", text: prompt }] };
    if (model) messageBody.model = model;
    if (agent) messageBody.agent = agent;

    const msgResp = await fetch(`${base}/session/${encodeURIComponent(sessionId)}/message`, {
      method: "POST",
      headers,
      body: JSON.stringify(messageBody),
    });
    if (!msgResp.ok) {
      console.error(`OpenCode message error: ${msgResp.status} ${await msgResp.text()}`);
      return null;
    }

    // Fast path: synchronous response already contains the assistant reply
    const data = await msgResp.json();
    const inline = extractAssistantText(data);
    if (inline) return inline;

    // Slow path: opencode may stream the reply over SSE while POST returns
    // immediately. Poll the session messages until a non-empty assistant
    // text appears or we hit maxWaitMs.
    const deadline = Date.now() + Math.max(0, maxWaitMs);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      const pollResp = await fetch(`${base}/session/${encodeURIComponent(sessionId)}/message`, { headers });
      if (!pollResp.ok) continue;
      const polled = await pollResp.json();
      const text = extractAssistantText(polled);
      if (text) return text;
    }

    console.error("OpenCode timed out waiting for assistant reply");
    return null;
  } catch (err) {
    console.error("OpenCode Fetch Error:", err);
    return null;
  }
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

export async function generateScripts({ niche, tone, count, lengthSeconds, includeVerseReference, ctaStyle, scriptType = "peace", customPrompt = "" }) {
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
Script type: ${SCRIPT_TYPE_TITLES[scriptType] || scriptType}
Theme brief: ${scriptType === "custom" && customPrompt ? customPrompt : (SCRIPT_TYPES[scriptType] || SCRIPT_TYPES.peace)}
Target length: ${lengthSeconds}s each
Rules:
- Hook: 1 short sentence. Do not always start with "Feeling overwhelmed" or "Feeling weak". Vary the opening by script type.
- Verse: short (paraphrase ok).
- Reference: ${includeVerseReference ? "include a real Bible reference" : "leave empty string"}.
- Reflection: 1-2 short sentences.
- CTA style: ${ctaStyle}
- Include 6-10 hashtags in the hashtags array only. Do NOT put hashtags, asterisks, markdown, bullets, or social symbols inside hook/verse/reflection/cta.
- Return ONLY valid JSON array.
Schema:
${JSON.stringify(schema)}
`;

  const history = loadHistory();
  const historyKeys = new Set(history);

  let raw = await opencodeGenerate(prompt);
  if (!raw) raw = await geminiGenerate(prompt);
  if (!raw) raw = await openaiGenerate(prompt);

  if (!raw) {
    const scripts = finalizeScripts({ preferred: [], count, ctaStyle, historyKeys, scriptType });
    saveHistory([...historyKeys]);
    return scripts;
  }

  const firstBracket = raw.indexOf("[");
  const lastBracket = raw.lastIndexOf("]");
  if (firstBracket === -1 || lastBracket === -1) {
    const scripts = finalizeScripts({ preferred: [], count, ctaStyle, historyKeys, scriptType });
    saveHistory([...historyKeys]);
    return scripts;
  }

  const jsonText = raw.slice(firstBracket, lastBracket + 1);
  try {
    const parsed = JSON.parse(jsonText);
    const list = Array.isArray(parsed) ? parsed : [];
    const normalized = list.map((x, i) => sanitizeScriptObject({
      title: String(x?.title || `${SCRIPT_TYPE_TITLES[scriptType] || "Biblefuel Post"} #${i + 1}`).trim(),
      hook: String(x?.hook || "").trim(),
      verse: String(x?.verse || "").trim(),
      reference: includeVerseReference ? String(x?.reference || "").trim() : "",
      reflection: String(x?.reflection || "").trim(),
      cta: String(x?.cta || CTA_MAP[ctaStyle] || CTA_MAP.save).trim(),
      hashtags: Array.isArray(x?.hashtags) ? x.hashtags.map((h) => String(h || "").trim()).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`)) : [],
    })).filter((x) => x.hook && x.verse && x.reflection);

    const scripts = finalizeScripts({ preferred: normalized, count, ctaStyle, historyKeys, scriptType });
    saveHistory([...historyKeys]);
    return scripts;
  } catch {
    const scripts = finalizeScripts({ preferred: [], count, ctaStyle, historyKeys, scriptType });
    saveHistory([...historyKeys]);
    return scripts;
  }
}
