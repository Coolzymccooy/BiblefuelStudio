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

interface TimedWord { text: string; startMs: number; endMs: number }

function validWords(words: unknown): words is TimedWord[] {
    if (!Array.isArray(words) || !words.length) return false;
    return words.every((w, i) => typeof w?.text === 'string' && w.text.trim() &&
        Number.isFinite(w.startMs) && Number.isFinite(w.endMs) && w.startMs >= 0 && w.endMs > w.startMs &&
        (!i || (w.startMs >= words[i - 1].startMs && w.endMs >= words[i - 1].endMs)));
}

/** Native timing only. Never interpolate absent or malformed provider timing. */
export function storyProviderWords(data: { words?: unknown; alignment?: unknown }): TimedWord[] | undefined {
    if (validWords(data.words)) return data.words;
    const a = data.alignment as { characters?: unknown; starts?: unknown; ends?: unknown } | undefined;
    if (a && Array.isArray(a.characters) && Array.isArray(a.starts) && Array.isArray(a.ends) &&
        a.characters.length && a.characters.length === a.starts.length && a.characters.length === a.ends.length) {
        const words: TimedWord[] = [];
        let current: TimedWord | undefined;
        let previousStart = -Infinity;
        let previousEnd = -Infinity;
        let valid = true;
        for (let i = 0; i < a.characters.length; i++) {
            const ch = a.characters[i], start = a.starts[i], end = a.ends[i];
            if (typeof ch !== 'string' || !ch.length || typeof start !== 'number' || typeof end !== 'number' ||
                !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start ||
                start < previousStart || end < previousEnd || (/\s/u.test(ch) && !/^\s+$/u.test(ch))) {
                valid = false;
                break;
            }
            previousStart = start;
            previousEnd = end;
            if (/^\s+$/u.test(ch)) {
                if (current) words.push(current);
                current = undefined;
            } else if (current) {
                current.text += ch;
                current.endMs = end * 1000;
            } else current = { text: ch, startMs: start * 1000, endMs: end * 1000 };
        }
        if (current) words.push(current);
        if (valid && validWords(words)) return words;
    }
    const suppliedWords = data.words != null && !(Array.isArray(data.words) && !data.words.length);
    const alignment = a as { characters?: unknown[] } | undefined;
    if (suppliedWords || (alignment && (!Array.isArray(alignment.characters) || alignment.characters.length))) {
        throw new Error('Narration returned invalid timestamps. Retry narration or import without timings as an estimated draft.');
    }
    return undefined;
}


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
        // A failed measurement blocks import; the last word is not audio duration.
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
 * @param opts.aiMotion animate the scenes once the pictures are ready (the
 *   server keeps it only for a super admin); the video is portrait
 */
export async function narrateAndSendToStory(
    narrationText: string,
    opts: { title?: string; style?: string; category?: string; aiMotion?: boolean } = {},
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
    const durationMs = Math.round(durationSec * 1000);
    let words: TimedWord[] | undefined;
    try {
        words = storyProviderWords(tts.data);
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Invalid narration timestamps' };
    }

    if (!durationMs) return { ok: false, error: 'Could not determine narration length' };

    const created = await api.post('/api/story/import-script', {
        script: text,
        audioPath: file,
        durationMs,
        ...(words ? {
            words,
            // Preserve explicit synthesis handoff metadata when available. The
            // importer validates full deterministic text/map coverage itself.
            ...(tts.data.spokenText !== undefined ? { spokenText: tts.data.spokenText } : {}),
            ...(tts.data.tokenMap !== undefined ? { tokenMap: tts.data.tokenMap } : {}),
            timing: { provenance: 'supplied', estimated: tts.data.timing?.estimated === true, verified: false },
        } : {}),
        title: opts.title,
        style: opts.style,
        // The server builds the project itself (segment, pictures) rather than
        // leaving it for a manual Resume.
        autoStart: true,
        ...(opts.aiMotion ? { aiMotion: true, aspect: 'portrait' } : {}),
    });
    if (!created.ok || !created.data?.project) {
        return { ok: false, error: created.error || 'Could not create the Story project' };
    }

    return { ok: true, projectId: created.data.project.projectId as string };
}
