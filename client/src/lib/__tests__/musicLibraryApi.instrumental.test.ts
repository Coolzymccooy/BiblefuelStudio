import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../api';
import { fetchCapabilities, startInstrumental, cancelInstrumental, discardInstrumental } from '../musicLibraryApi';
import { ambientApi } from '../ambientApi';

beforeEach(() => vi.restoreAllMocks());

describe('instrumental API', () => {
  it('reads capabilities', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { ok: true, vocalRemoval: true, amfEncoder: false } } as never);
    expect(await fetchCapabilities()).toEqual({ vocalRemoval: true, vocalRemovalWhere: null, laptopOnline: false, amfEncoder: false });
  });

  it('reads that the laptop does vocal removal, and whether it is online', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { ok: true, vocalRemoval: true, vocalRemovalWhere: 'laptop', laptopOnline: true, amfEncoder: false } } as never);
    expect(await fetchCapabilities()).toEqual({ vocalRemoval: true, vocalRemovalWhere: 'laptop', laptopOnline: true, amfEncoder: false });
  });

  it('capabilities default to off when the call fails', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: false, error: 'x' } as never);
    expect(await fetchCapabilities()).toEqual({ vocalRemoval: false, vocalRemovalWhere: null, laptopOnline: false, amfEncoder: false });
  });

  it('starts a job with the chosen quality', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { ok: true, jobId: 'j1' } } as never);
    expect(await startInstrumental('t1', 'fast')).toBe('j1');
    expect(post).toHaveBeenCalledWith('/api/music/t1/instrumental', { quality: 'fast' });
  });

  it('cancel posts to the right URL on success', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: {} } as never);
    await cancelInstrumental('j1');
    expect(post).toHaveBeenCalledWith('/api/music/instrumental/j1/cancel', {});
  });

  it('cancel rejects with the server error when ok: false', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, error: 'Job not found' } as never);
    await expect(cancelInstrumental('j1')).rejects.toThrow('Job not found');
  });

  it('discard posts to the right URL on success', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: {} } as never);
    await discardInstrumental('j1');
    expect(post).toHaveBeenCalledWith('/api/music/instrumental/j1/discard', {});
  });

  it('discard rejects with the server error when ok: false', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, error: 'Cannot discard' } as never);
    await expect(discardInstrumental('j1')).rejects.toThrow('Cannot discard');
  });
});

describe('ambient API', () => {
  it('setWords patches /api/ambient/p1/words with { words: "none" }', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({
      ok: true,
      data: { project: { projectId: 'p1', words: 'none' } },
    } as never);
    await ambientApi.setWords('p1', 'none');
    expect(patch).toHaveBeenCalledWith('/api/ambient/p1/words', { words: 'none' });
  });

  it('render posts { encoder: "amf" }', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      data: { ok: true, jobId: 'r1' },
    } as never);
    await ambientApi.render('p1', 'amf');
    expect(post).toHaveBeenCalledWith('/api/ambient/p1/render', { encoder: 'amf' });
  });
});
