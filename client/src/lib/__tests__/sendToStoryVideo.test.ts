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
    const call = post.mock.calls.find((c) => c[0] === '/api/story/import-script');
    expect(call).toBeTruthy();
    return call![1] as Record<string, unknown>;
};

describe('narrateAndSendToStory', () => {
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
