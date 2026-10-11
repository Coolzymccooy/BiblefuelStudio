import { uploadMedia } from './mediaUpload';
import { storyApi } from './storyApi';
import type { StoryProject, StoryScene } from './storyTypes';

/**
 * Putting your own pictures on Story scenes: for when the free image quota
 * has run out and the pictures come from ChatGPT, Gemini or your camera roll.
 */

/** The scene number in a file name like "Scene 3.png" or "scene_07.jpg", or null. */
export function sceneNumberIn(name: string): number | null {
  // "scene" as its own word: "obscene 2.png" is not scene 2.
  const m = /(?:^|[^a-z])scene[\s_-]*0*(\d+)/i.exec(name);
  return m ? Number(m[1]) : null;
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Which file goes on which scene. A file named for its scene ("Scene 3.png",
 * as the image brief asks) goes on that scene, even one that already has a
 * picture: you named it. The rest fill the scenes still without a picture, in
 * order, sorted by name as people number them (2 before 10). Anything left
 * over comes back in `extra`.
 */
export function pairFilesWithScenes<F extends { name: string }>(
  files: F[],
  scenes: StoryScene[],
): { pairs: Array<{ file: F; scene: StoryScene }>; extra: F[] } {
  const pairs: Array<{ file: F; scene: StoryScene }> = [];
  const extra: F[] = [];
  const taken = new Set<string>();
  const unnumbered: F[] = [];

  for (const f of [...files].sort((a, b) => byName.compare(a.name, b.name))) {
    const n = sceneNumberIn(f.name);
    if (n === null) { unnumbered.push(f); continue; }
    const target = scenes[n - 1];
    if (target && !taken.has(target.id)) {
      taken.add(target.id);
      pairs.push({ file: f, scene: target });
    } else {
      extra.push(f);
    }
  }

  const gaps = scenes.filter((s) => s.imageStatus !== 'done' && !taken.has(s.id));
  unnumbered.forEach((f, i) => {
    if (gaps[i]) pairs.push({ file: f, scene: gaps[i] });
    else extra.push(f);
  });

  pairs.sort((a, b) => scenes.indexOf(a.scene) - scenes.indexOf(b.scene));
  return { pairs, extra };
}

/** The server's cap on a scene clip (server/src/lib/story/sceneVideo.js). */
export const MAX_SCENE_VIDEO_BYTES = 200 * 1024 * 1024;
/** Word for word what the server says about a clip over the cap. */
export const SCENE_VIDEO_TOO_BIG = 'That clip is over 200 MB. Use a shorter clip or the HD (1080p) version.';

function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name);
}

/**
 * Upload a photo or a video clip and put it on one scene. The server tells
 * the two apart, checks a clip a render can use, and gives it a poster. A
 * clip over the server's cap is refused here, before minutes of uploading.
 */
export async function putOwnImage(projectId: string, sceneId: string, file: File): Promise<StoryProject> {
  if (isVideoFile(file) && file.size > MAX_SCENE_VIDEO_BYTES) throw new Error(SCENE_VIDEO_TOO_BIG);
  const uploaded = await uploadMedia(file, file.name, 'background');
  return storyApi.setSceneImage(projectId, sceneId, { uploadPath: uploaded.file });
}
