import fetch from "node-fetch";

function fallbackScripts(count, ctaStyle) {
  const ctas = {
    save: "Save this verse.",
    follow: "Follow @Biblefuel for daily encouragement.",
    share: "Share this with someone who needs it.",
    comment: "Comment 'amen' if you receive it."
  };
  const items = [];
  const samples = [
    {
      hook: "If today feels heavy, this is for you.", verse: "The Lord is close to the brokenhearted.", reference: "Psalm 34:18",
      reflection: "You’re not alone. God is nearer than you think."
    },
    {
      hook: "God hasn’t forgotten you.", verse: "I know the plans I have for you…", reference: "Jeremiah 29:11",
      reflection: "Delay isn’t denial. Stay faithful."
    },
    {
      hook: "This will calm your anxiety.", verse: "Cast all your anxiety on Him…", reference: "1 Peter 5:7",
      reflection: "You were never meant to carry it alone."
    },
    {
      hook: "Don’t scroll. You needed this.", verse: "Be still, and know that I am God.", reference: "Psalm 46:10",
      reflection: "Rest is an act of trust."
    },
  ];
  for (let i = 0; i < count; i++) {
    const s = samples[i % samples.length];
    items.push({ ...s, cta: ctas[ctaStyle] || ctas.save, title: `Biblefuel Post #${i + 1}` });
  }
  return items;
}

async function openaiGenerate(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.startsWith("your-")) return null;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8
      })
    });
    if (!resp.ok) {
      console.error(`OpenAI Error: ${resp.status} ${await resp.text()}`);
      return null;
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? "";
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
        generationConfig: { temperature: 0.8 }
      })
    });
    if (!resp.ok) {
      console.error(`Gemini Error: ${resp.status} ${await resp.text()}`);
      return null;
    }
    const data = await resp.json();
    return data.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ?? "";
  } catch (err) {
    console.error("Gemini Fetch Error:", err);
    return null;
  }
}

export async function generateScripts({ niche, tone, count, lengthSeconds, includeVerseReference, ctaStyle }) {
  // ... (schema and prompt omitted for brevity in replacement, but I will keep them)
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
        hashtags: { type: "array", items: { type: "string" } }
      },
      required: ["title", "hook", "verse", "reflection", "cta", "hashtags"]
    }
  };

  const prompt = `
Generate ${count} faceless TikTok scripts for a theme page in the niche: ${niche}.
Tone: ${tone}.
Target length: ${lengthSeconds}s each.
Rules:
- Hook must be 1 short sentence.
- Verse must be short (paraphrase ok) and ${includeVerseReference ? "include" : "do NOT include"} a verse reference field.
- Reflection 1-2 short sentences.
- CTA should be ${ctaStyle}.
- Include 6-10 hashtags per script (Christian, faith, encouragement).
- Return ONLY the JSON array.
Return JSON ONLY that matches this JSON Schema:
${JSON.stringify(schema)}
`;

  // Try Gemini First as requested, then OpenAI; else fallback
  let raw = await geminiGenerate(prompt);
  if (!raw) raw = await openaiGenerate(prompt);

  if (!raw) return fallbackScripts(count, ctaStyle);

  // Extract JSON safely
  const firstBracket = raw.indexOf("[");
  const lastBracket = raw.lastIndexOf("]");
  if (firstBracket === -1 || lastBracket === -1) return fallbackScripts(count, ctaStyle);
  const jsonText = raw.slice(firstBracket, lastBracket + 1);

  try {
    const parsed = JSON.parse(jsonText);
    // normalize fields
    return parsed.map((x, i) => ({
      title: x.title || `Biblefuel Post #${i + 1}`,
      hook: x.hook?.trim() || "",
      verse: x.verse?.trim() || "",
      reference: (x.reference || "").trim(),
      reflection: x.reflection?.trim() || "",
      cta: x.cta?.trim() || "",
      hashtags: Array.isArray(x.hashtags) ? x.hashtags.map(h => h.replace(/^#?/, "#")) : []
    }));
  } catch {
    return fallbackScripts(count, ctaStyle);
  }
}
