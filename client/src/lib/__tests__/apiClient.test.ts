import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { api } from '../api';

describe('api.put', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends a PUT and unwraps the response', async () => {
    const put = vi.spyOn(axios, 'put').mockResolvedValue({ status: 200, data: { project: { projectId: 'p' } } });
    const res = await api.put('/api/x', { a: 1 });
    expect(put).toHaveBeenCalledWith('/api/x', { a: 1 }, expect.objectContaining({ headers: expect.any(Object) }));
    expect(res).toEqual({ ok: true, status: 200, data: { project: { projectId: 'p' } } });
  });

  it("carries the server's own sentence on a refusal", async () => {
    const err = Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: { status: 400, data: { error: 'Paste the lyrics, one line per line.' } },
    });
    vi.spyOn(axios, 'put').mockRejectedValue(err);
    vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    const res = await api.put('/api/x', {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toBe('Paste the lyrics, one line per line.');
  });
});

describe('api.getText', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the response body as text and sends the auth header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '[Script Info]' });
    vi.stubGlobal('fetch', fetchMock);
    api.setToken('tok');
    try {
      await expect(api.getText('/api/lyric-video/lv_1/captions.ass?w=1&h=2')).resolves.toBe('[Script Info]');
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/lyric-video/lv_1/captions.ass?w=1&h=2',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }),
      );
    } finally {
      api.setToken(null);
    }
  });

  it('returns an empty string for an empty body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' }));
    await expect(api.getText('/x')).resolves.toBe('');
  });

  it('throws "HTTP <status>" when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'nope' }));
    await expect(api.getText('/x')).rejects.toThrow('HTTP 404');
  });
});
