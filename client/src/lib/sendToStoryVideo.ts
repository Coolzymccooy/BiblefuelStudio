/**
 * Bridge: narrate an already-written script and hand it to **Story Video**.
 *
 * The Timeline handoff (see gumroadToTimeline) passes work through
 * localStorage because Timeline is a client-side editor. Story Video is
 * server-side — projects live on disk and the pipeline runs in stages — so the
 * handoff instead creates a real project via `/api/story/import-script` and
 * navigates to it.
 *
 * Why not reuse `/api/story/script-to-audio`? That endpoint runs the text
 * through `refineScript` first, which rewrites it to fit a template. A Gumroad
 * devotional or a Series part is already written and reviewed; rewriting it on
 * the way to video would discard the operator's own words. This path narrates
 * verbatim.
 */
import { api } from './api';
import { extractTranscript, type TranscriptWord } from './gumroadToTimeline';

/** Narration synthesis routinely exceeds the default 15s client timeout. */
const GENERATE_TIMEOUT_MS = 120_000;

export interface SendToStoryResult {
    ok: boolean;
    projectId?: string;
    error?: string;
}

/**
 * Read an audio file's duration by loading it in a detached <audio> element.
 * Story needs a real duration to place scene boundaries.
 */
export function getAudioDurationSec(url: string): Promise<number> {
    return new Promise((resolve) => {
        const el = new Audio();
        // Resolve to 0 rather than rejecting: the server recomputes duration
        // from the word timings, so a failed probe degrades instead of blocking.
        const done = (v: number) => resolve(Number.isFinite(v) && v > 0 ? v : 0);
        el.addEventListener('loadedmetadata', () => done(el.duration));
        el.addEventListener('error', () => done(0));
        el.src = url;
    });
}

/**
 * Narrate `narrationText`, then create a Story Video project from it.
 *
 * @param narrationText the words to speak — used verbatim, never refined
 * @param opts.title    project title shown in the Story list
 * @param opts.style    style anchor key (cinematic-bible, etc.)
 * @param opts.category voice category for synthesis
 */
export async function narrateAndSendToStory(
    narrationText: string,
    opts: { title?: string; style?: string; category?: string } = {},
): Promise<SendToStoryResult> {
    const text = String(narrationText || '').trim();
    if (!text) return { ok: false, error: 'Nothing to narrate' };

    const tts = await api.post(
        '/api/tts/synthesize-category',
        { text, category: opts.category || 'devotional', withTimestamps: true },
        undefined,
        { timeout: GENERATE_TIMEOUT_MS },
    );
    if (!tts.ok || !tts.data?.file) {
        return { ok: false, error: tts.error || 'Narration failed' };
    }

    const file = tts.data.file as string;
    const durationSec = await getAudioDurationSec(api.mediaUrl(file));
    const words: TranscriptWord[] = extractTranscript(tts.data, text, durationSec);

    // Prefer the measured duration; fall back to the last word's end so a
    // failed metadata probe still yields a usable project.
    const durationMs = durationSec > 0
        ? Math.round(durationSec * 1000)
        : (words.length ? words[words.length - 1].endMs : 0);

    if (!durationMs) return { ok: false, error: 'Could not determine narration length' };

    const created = await api.post('/api/story/import-script', {
        script: text,
        audioPath: file,
        durationMs,
        words,
        title: opts.title,
        style: opts.style,
    });
    if (!created.ok || !created.data?.project) {
        return { ok: false, error: created.error || 'Could not create the Story project' };
    }

    return { ok: true, projectId: created.data.project.projectId as string };
}
