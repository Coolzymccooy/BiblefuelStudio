import { z } from "zod";

export const GenerateScriptsSchema = z.object({
  niche: z.string().default("Christian / Bible encouragement"),
  tone: z.string().default("warm, encouraging, simple"),
  count: z.number().int().min(1).max(100).default(10),
  lengthSeconds: z.number().int().min(8).max(90).default(20),
  includeVerseReference: z.boolean().default(true),
  ctaStyle: z.enum(["save", "follow", "share", "comment"]).default("save"),
});

export const QueueAddSchema = z.object({
  title: z.string().min(2).max(120),
  hook: z.string().min(2).max(200),
  verse: z.string().min(2).max(300),
  reference: z.string().optional().default(""),
  reflection: z.string().min(2).max(300),
  cta: z.string().min(2).max(120),
  hashtags: z.array(z.string()).default([]),
  notes: z.string().optional().default(""),
});
