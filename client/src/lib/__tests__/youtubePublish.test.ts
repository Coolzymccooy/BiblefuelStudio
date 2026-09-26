import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../api';
import { publishToYoutube } from '../youtubePublish';

const body = { videoUrl: '/outputs/v.mp4', title: 'Still Waters' };
const job = (status: string, extra: Record<string, unknown> = {}) =>
  ({ ok: true, status: 200, data: { ok: true, job: { jobId: 'j1', status, ...extra } } }) as never;

beforeEach(() => vi.restoreAllMocks());

describe('publishToYoutube', () => {
  it('starts the upload as a job and follows it to the finished video', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, jobId: 'j1' } } as never);
    const get = vi.spyOn(api, 'get')
      .mockResolvedValueOnce(job('running'))
      .mockResolvedValueOnce(job('done', { result: { videoId: 'v1', videoUrl: 'u', forcedPrivate: false } }));
    const out = await publishToYoutube(body, { pollMs: 1 });
    expect(post).toHaveBeenCalledWith('/api/social/youtube/publish', body);
    expect(get).toHaveBeenCalledWith('/api/social/youtube/publish/j1');
    expect(out).toEqual({ ok: true, result: { videoId: 'v1', videoUrl: 'u', forcedPrivate: false } });
  });

  it('says when the request joined an upload that was already running', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, jobId: 'j1', joined: true } } as never);
    vi.spyOn(api, 'get').mockResolvedValue(job('done', { result: { videoId: 'v1', videoUrl: 'u', forcedPrivate: false } }));
    const onJoined = vi.fn();
    await publishToYoutube(body, { pollMs: 1, onJoined });
    expect(onJoined).toHaveBeenCalledTimes(1);
  });

  it('reports a refusal before the upload starts', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 400, error: 'Title is required' } as never);
    expect(await publishToYoutube(body, { pollMs: 1 })).toEqual({ ok: false, error: 'Title is required' });
  });

  it("reports the upload's own failure", async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, jobId: 'j1' } } as never);
    vi.spyOn(api, 'get').mockResolvedValue(job('error', { error: 'quotaExceeded' }));
    expect(await publishToYoutube(body, { pollMs: 1 })).toEqual({ ok: false, error: 'quotaExceeded' });
  });

  it('rides out a few failed checks, since the upload itself carries on', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, jobId: 'j1' } } as never);
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ ok: false, status: 0, error: 'Network Error' } as never)
      .mockResolvedValueOnce({ ok: false, status: 502, error: 'Bad gateway' } as never)
      .mockResolvedValueOnce(job('done', { result: { videoId: 'v1', videoUrl: 'u', forcedPrivate: false } }));
    const out = await publishToYoutube(body, { pollMs: 1 });
    expect(out.ok).toBe(true);
  });

  it('after too many failed checks, says the upload may still arrive rather than that it failed', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, jobId: 'j1' } } as never);
    vi.spyOn(api, 'get').mockResolvedValue({ ok: false, status: 0, error: 'Network Error' } as never);
    const out = await publishToYoutube(body, { pollMs: 1 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/may still finish.*YouTube Studio/i);
  });

  it('stops following when the page no longer needs it, without calling it a failure', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, jobId: 'j1' } } as never);
    const get = vi.spyOn(api, 'get').mockResolvedValue(job('running'));
    let stop = false;
    const pending = publishToYoutube(body, { pollMs: 1, shouldStop: () => stop });
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    stop = true;
    expect(await pending).toEqual({ ok: false, stopped: true });
  });
});
