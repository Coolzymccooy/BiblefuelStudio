import { describe, it, expect, vi, beforeEach } from 'vitest';
import { momentsApi } from '../momentsApi';
import { api } from '../api';
import { isApiError } from '../apiError';

beforeEach(() => vi.restoreAllMocks());

describe('momentsApi', () => {
  it('unwraps a project and throws the server error', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ ok: true, status: 200, data: { ok: true, project: { projectId: 'm1' } } });
    expect((await momentsApi.get('m1')).projectId).toBe('m1');
    vi.spyOn(api, 'put').mockResolvedValueOnce({ ok: false, status: 400, error: 'Photo 2: that photo was not found.' });
    await expect(momentsApi.update('m1', { title: 'x' })).rejects.toThrow('Photo 2');
  });
  it('sends the seed only when Shuffle gives one', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, jobId: 'j' } });
    await momentsApi.render('m1');
    await momentsApi.render('m1', 42);
    expect(post.mock.calls[0][1]).toEqual({});
    expect(post.mock.calls[1][1]).toEqual({ seed: 42 });
  });
  it('a 409 reads as already rendering', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 409, error: 'this Moment is already rendering' });
    await expect(momentsApi.render('m1')).rejects.toThrow(/already rendering/);
  });
  it('a 429 quota response rejects with an ApiError carrying the server code', async () => {
    const body = {
      ok: false,
      error: 'QUOTA_EXCEEDED',
      bucket: 'render',
      used: 5,
      limit: 5,
      plan: 'free',
      hint: 'Upgrade to Premium for unlimited generation, or come back tomorrow — quota resets at midnight UTC.',
    };
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 429, error: 'QUOTA_EXCEEDED', data: body });
    const err = await momentsApi.render('m1').catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    if (!isApiError(err)) throw new Error('expected an ApiError');
    expect(err.code).toBe('QUOTA_EXCEEDED');
    expect(err.payload.bucket).toBe('render');
    expect(err.message).toBe(body.hint);
  });
  it('a coded error with no message reads as its code', async () => {
    vi.spyOn(api, 'put').mockResolvedValueOnce({ ok: false, status: 500, data: { ok: false, error: 'RENDER_BROKEN' } });
    const err = await momentsApi.update('m1', { title: 'x' }).catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    if (!isApiError(err)) throw new Error('expected an ApiError');
    expect(err.code).toBe('RENDER_BROKEN');
    expect(err.message).toBe('RENDER_BROKEN');
  });
});
