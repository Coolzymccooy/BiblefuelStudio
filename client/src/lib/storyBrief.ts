import type { StoryProject, StoryScene } from './storyTypes';
import { STORY_STYLES, sceneTimeLabel } from './storyWizard';

/**
 * Everything an outside image AI (ChatGPT, Gemini, …) needs to make a Story
 * project's pictures, as one block of text to paste: what to make and at what
 * size, the look, the cast, every scene's words and image prompt with whether
 * it still needs a picture, and the full transcript for context.
 *
 * Built in the browser, from the project already on screen, so Copy writes to
 * the clipboard straight from the tap; iPhone Safari refuses a clipboard
 * write that waits on a network call first.
 */

export interface CastCharacter { key: string; description: string }

export interface BriefOptions {
  /** Only the scenes still without a picture (their numbers are kept). */
  onlyMissing?: boolean;
  /** The cast list from GET /api/story/characters, to describe each person. */
  characters?: CastCharacter[];
}

const needsImage = (s: StoryScene) => s.imageStatus !== 'done';

export function scenesNeedingImages(project: StoryProject): StoryScene[] {
  return project.scenes.filter(needsImage);
}

function frameLine(project: StoryProject): string {
  return project.aspect === 'landscape' ? 'Landscape 16:9 (1920×1080)' : 'Portrait 9:16 (1080×1920)';
}

function lengthLabel(project: StoryProject): string {
  const last = project.scenes[project.scenes.length - 1];
  const ms = last ? last.endMs : project.source.durationMs;
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function transcriptText(project: StoryProject): string {
  const words = project.transcript?.words ?? [];
  const text = words.length ? words.map((w) => w.text).join(' ') : project.scenes.map((s) => s.text).join(' ');
  return text.replace(/\s+/g, ' ').trim();
}

function instructions(project: StoryProject, missing: number): string[] {
  const total = project.scenes.length;
  const which = missing === total
    ? '- Make one image for every scene below, in order.'
    : missing === 0
      ? '- Every scene already has an image. Make new ones only for the scenes I ask you to replace.'
      : `- Make images only for the ${missing === 1 ? 'scene' : `${missing} scenes`} marked NEEDS IMAGE, in order.`;
  return [
    'WHAT TO MAKE',
    which,
    '- Label each image with its scene number (Scene 1, Scene 2, …) so I can match them up.',
    `- Size: ${frameLine(project)}.`,
    '- No words, letters, captions, logos or watermarks in any image.',
    '- Keep one consistent look across every image: the same style, lighting and people.',
  ];
}

function castLines(project: StoryProject, characters: CastCharacter[]): string[] {
  const cast = project.cast ?? [];
  if (!cast.length) return [];
  const described = new Map(characters.map((c) => [c.key, c.description]));
  return [
    '',
    'CAST (keep each person looking the same in every scene)',
    ...cast.map((key) => {
      const name = key.replace(/_/g, ' ');
      const description = described.get(key);
      return description ? `- ${name}: ${description}` : `- ${name}`;
    }),
  ];
}

function sceneBlock(s: StoryScene, number: number, markStatus: boolean): string[] {
  const status = markStatus ? ` · ${needsImage(s) ? 'NEEDS IMAGE' : 'HAS IMAGE'}` : '';
  return [
    '',
    `Scene ${number} · ${sceneTimeLabel(s)}${status}`,
    `Words: "${s.text}"`,
    `Image prompt: ${s.imagePrompt}`,
  ];
}

export function buildImageBrief(project: StoryProject, opts: BriefOptions = {}): string {
  const missing = scenesNeedingImages(project).length;
  const total = project.scenes.length;
  const style = STORY_STYLES.find((s) => s.id === project.style);
  const markStatus = missing < total;
  const scenes = project.scenes
    .map((s, i) => ({ s, number: i + 1 }))
    .filter(({ s }) => !opts.onlyMissing || needsImage(s));

  return [
    `IMAGE BRIEF: "${project.title || 'Untitled story'}"`,
    'From BibleFuel Studio. Paste this into ChatGPT, Gemini or any image AI.',
    '',
    ...instructions(project, missing),
    '',
    'STYLE',
    style ? `${style.label}: ${style.blurb}` : project.style,
    ...castLines(project, opts.characters ?? []),
    '',
    `LENGTH: ${total} scenes, ${lengthLabel(project)}`,
    '',
    opts.onlyMissing ? 'SCENES STILL NEEDING AN IMAGE' : 'SCENES',
    ...scenes.flatMap(({ s, number }) => sceneBlock(s, number, markStatus)),
    '',
    'FULL TRANSCRIPT (for context)',
    transcriptText(project),
    '',
  ].join('\n');
}

export function briefFileName(project: StoryProject): string {
  const slug = String(project.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'story'}-image-brief.txt`;
}
