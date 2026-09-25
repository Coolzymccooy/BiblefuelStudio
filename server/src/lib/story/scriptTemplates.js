/**
 * Story Video script templates. `prompt` is the tone/structure guidance fed to
 * the refiner; `targetSeconds` sets the narration length. `custom` adds no tone.
 */
export const SCRIPT_TEMPLATES = [
  { id: "devotional-30", label: "30s Devotional", targetSeconds: 30, prompt: "Write a warm, encouraging devotional. Open with a relatable feeling, turn to a hopeful biblical truth, and close with a short call to trust God." },
  { id: "teaching-60", label: "60s Teaching", targetSeconds: 60, prompt: "Write a clear, simple Bible teaching on the idea. State one main point, support it with a scriptural thought, and end with a practical takeaway." },
  { id: "meditation", label: "Scripture Meditation", targetSeconds: 45, prompt: "Write a calm, slow, reflective scripture meditation. Use gentle, unhurried sentences and invite the listener to dwell on the truth." },
  { id: "testimony", label: "Testimony / Encouragement", targetSeconds: 45, prompt: "Write an uplifting, first-person encouragement in a testimony tone. Be hopeful and personal, ending with assurance." },
  { id: "custom", label: "Custom", targetSeconds: 40, prompt: "" },
];

/** Look up a template by id; falls back to the custom template. */
export function templateById(id) {
  return SCRIPT_TEMPLATES.find((t) => t.id === id) || SCRIPT_TEMPLATES.find((t) => t.id === "custom");
}
