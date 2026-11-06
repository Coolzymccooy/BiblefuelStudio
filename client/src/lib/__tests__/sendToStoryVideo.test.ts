import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../api';
import { narrateAndSendToStory } from '../sendToStoryVideo';

/** An <audio> stand-in that reports a 4 s file as soon as a src is set. */
class FakeAudio {
    duration = 4;
    private listeners: Record<string, () => void> = {};
    addEventListener(name: string, fn: () => void) { this.listeners[name] = fn; }
    set src(_v: string) { queueMicrotask(() => this.listeners.loadedmetadata?.()); }
}

let post: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.stubGlobal('Audio', FakeAudio);
    post = vi.spyOn(api, 'post').mockImplementation(async (url: string) => {
        if (url === '/api/tts/synthesize-category') {
            return { ok: true, data: { file: '/out/tts-1.mp3', words: [{ text: 'Hello', startMs: 0, endMs: 4000 }] } } as never;
        }
        return { ok: true, data: { project: { projectId: 'p1' } } } as never;
    });
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const importBody = () => {
    const call = post.mock.calls.find((c: unknown[]) => c[0] === '/api/story/import-script');
    expect(call).toBeTruthy();
    return call![1] as Record<string, unknown>;
};

describe('narrateAndSendToStory', () => {
    it('hands authored script and exact supported expansion boundaries through unchanged', async () => {
        const script = 'Read 1 John 3:16-18 today';
        const spokenText = 'Read 1 John chapter three verses sixteen to eighteen today';
        const words = spokenText.split(' ').map((text, i) => ({ text, startMs: i * 100, endMs: (i + 1) * 100 }));
        const tokenMap = [
            { tokenIndex: 0, spokenStart: 0, spokenEnd: 1 }, { tokenIndex: 1, spokenStart: 1, spokenEnd: 2 },
            { tokenIndex: 2, spokenStart: 2, spokenEnd: 3 }, { tokenIndex: 3, spokenStart: 3, spokenEnd: 9 },
            { tokenIndex: 4, spokenStart: 9, spokenEnd: 10 },
        ];
        post.mockResolvedValueOnce({ ok: true, data: { file: '/out/tts.mp3', words, spokenText, tokenMap, timing: { estimated: true, verified: true } } } as never);
        expect((await narrateAndSendToStory(script)).ok).toBe(true);
        expect(importBody()).toMatchObject({ script, words, spokenText, tokenMap,
            timing: { provenance: 'supplied', estimated: true, verified: false } });
    });


    it('preserves native windows and measured duration', async () => {
        await narrateAndSendToStory('Hello');
        expect(importBody().words).toEqual([{ text: 'Hello', startMs: 0, endMs: 4000 }]);
        expect(importBody().durationMs).toBe(4000);
    });

    it('omits words when no timestamps exist (server labels estimated draft)', async () => {
        post.mockResolvedValueOnce({ ok: true, data: { file: '/out/tts.mp3' } } as never);
        await narrateAndSendToStory('No timestamps');
        expect(importBody()).not.toHaveProperty('words');
        expect(importBody().durationMs).toBe(4000);
    });

    it('converts real ElevenLabs character-only alignment retaining Unicode/punctuation', async () => {
        const characters = Array.from('Éloï! Dieu');
        post.mockResolvedValueOnce({ ok: true, data: { file: '/out/tts.mp3', alignment: {
            characters, starts: characters.map((_, i) => i / 10), ends: characters.map((_, i) => (i + 1) / 10),
        } } } as never);
        await narrateAndSendToStory('Éloï! Dieu');
        expect(importBody().words).toEqual([
            { text: 'Éloï!', startMs: 0, endMs: 500 },
            { text: 'Dieu', startMs: 600, endMs: 1000 },
        ]);
    });

    it('rejects malformed native whole-source instead of forwarding a valid subset', async () => {
        post.mockResolvedValueOnce({ ok: true, data: { file: '/out/tts.mp3', words: [
            { text: 'hello', startMs: 0, endMs: 300 }, { text: 'there' },
        ] } } as never);
        expect((await narrateAndSendToStory('hello there')).error).toMatch(/invalid timestamps/i);
        expect(post).toHaveBeenCalledTimes(1);
    });

    it('prefers valid native words over differing character timing', async () => {
        const words = [{ text: 'Hello', startMs: 100, endMs: 900 }];
        post.mockResolvedValueOnce({ ok: true, data: { file: '/out/tts.mp3', words,
            alignment: { characters: ['Hello'], starts: [0], ends: [2] },
        } } as never);
        await narrateAndSendToStory('Hello');
        expect(importBody().words).toEqual(words);
    });

    it('uses valid character alignment if native source is malformed', async () => {
        post.mockResolvedValueOnce({ ok: true, data: { file: '/out/tts.mp3', words: [{ text: 'Hello' }],
            alignment: { characters: ['Hello'], starts: [0.1], ends: [0.9] },
        } } as never);
        await narrateAndSendToStory('Hello');
        expect(importBody().words).toEqual([{ text: 'Hello', startMs: 100, endMs: 900 }]);
    });

    it('rejects malformed character timing rather than manufacturing timestamps', async () => {
        post.mockResolvedValueOnce({ ok: true, data: { file: '/out/tts.mp3', alignment: {
            characters: ['H', 'i'], starts: [0], ends: [0.1, 0.2],
        } } } as never);
        expect((await narrateAndSendToStory('Hi')).ok).toBe(false);
        expect(post).toHaveBeenCalledTimes(1);
    });

    it('does not use native last-word end or speaking rate when duration measurement fails', async () => {
        class BrokenAudio extends FakeAudio { duration = NaN; }
        vi.stubGlobal('Audio', BrokenAudio);
        expect(await narrateAndSendToStory('Hello')).toEqual({ ok: false, error: 'Could not determine narration length' });
        expect(post).toHaveBeenCalledTimes(1);
    });

    it('always asks the server to build the project itself, and sends no AI motion by default', async () => {
        const res = await narrateAndSendToStory('Hello', { title: 'T' });
        expect(res).toEqual({ ok: true, projectId: 'p1' });
        const body = importBody();
        expect(body.autoStart).toBe(true);
        expect(body).not.toHaveProperty('aiMotion');
        expect(body).not.toHaveProperty('aspect');
        expect(body.audioPath).toBe('/out/tts-1.mp3');
    });

    it('with aiMotion it also sends aiMotion and a portrait frame', async () => {
        await narrateAndSendToStory('Hello', { title: 'T', aiMotion: true });
        const body = importBody();
        expect(body.autoStart).toBe(true);
        expect(body.aiMotion).toBe(true);
        expect(body.aspect).toBe('portrait');
    });

    it('aiMotion false is the same as leaving it out', async () => {
        await narrateAndSendToStory('Hello', { aiMotion: false });
        const body = importBody();
        expect(body).not.toHaveProperty('aiMotion');
        expect(body).not.toHaveProperty('aspect');
    });
});
