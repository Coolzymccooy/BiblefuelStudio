import { z } from "zod";

// Runtime validation at the orchestrator boundary. Keep schemas permissive —
// the legacy callers pass loose shapes and we don't want this refactor to
// reject inputs the old code accepted. Only `text` is genuinely required.

export const ProsodyHintSchema = z
  .object({
    rate: z.string().optional(),
    pitch: z.string().optional(),
    volume: z.string().optional(),
  })
  .strict()
  .partial();

export const VoiceSettingsSchema = z
  .object({
    stability: z.number().min(0).max(1).optional(),
    similarity_boost: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
    use_speaker_boost: z.boolean().optional(),
  })
  .partial()
  .passthrough(); // tolerate forward-compat extra fields

export const SpeechRequestSchema = z
  .object({
    text: z.string().trim().min(3, "text required (min 3 chars)"),
    voiceId: z.string().optional(),
    voiceIds: z.record(z.string(), z.string()).optional(),
    withTimestamps: z.boolean().optional(),
    forcedAlignmentFallback: z.boolean().optional(),
    voiceSettings: VoiceSettingsSchema.optional(),
    modelId: z.string().optional(),
    prosody: ProsodyHintSchema.optional(),
    preferredProvider: z.string().optional(),
  })
  .passthrough();

export const CharAlignmentSchema = z.object({
  characters: z.array(z.string()),
  starts: z.array(z.number()),
  ends: z.array(z.number()),
});

// Normalized word timing — the unit of the unified kinetic-caption contract
// ({ audioPath, words: WordTiming[] }). Millisecond offsets; Azure populates
// these natively, other providers map in via alignmentContract.js.
export const WordTimingSchema = z.object({
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
});

export const SpeechResultSchema = z
  .object({
    ok: z.literal(true),
    file: z.string().min(1),
    provider: z.string().min(1),
    voice: z.string().min(1),
    alignment: CharAlignmentSchema.optional(),
    words: z.array(WordTimingSchema).optional(),
  })
  .passthrough();

export const ProviderCapabilitiesSchema = z.object({
  wordTimestamps: z.boolean(),
  charTimestamps: z.boolean(),
  emotionControls: z.boolean(),
  ssml: z.boolean(),
  streaming: z.boolean(),
  // Optional descriptive flags added for the cloud/local provider expansion
  // (Fish/Coqui/Piper). Legacy five-flag providers omit them, so they stay
  // optional and existing providers validate unchanged.
  voiceClone: z.boolean().optional(),
  multilingual: z.boolean().optional(),
});
