import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../api';
import { fetchCapabilities, startInstrumental, keepInstrumental } from '../musicLibraryApi';

beforeEach(() => vi.restoreAllMocks());

describe('instrumental API', () => {
  it('reads capabilities', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { ok: true, vocalRemoval: true, amfEncoder: false } } as never);
    expect(await fetchCapabilities()).toEqual({ vocalRemoval: true, amfEncoder: false });
  });

  it('capabilities default to off when the call fails', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: false, error: 'x' } as never);
    expect(await fetchCapabilities()).toEqual({ vocalRemoval: false, amfEncoder: false });
  });

  it('starts a job with the chosen quality', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { ok: true, jobId: 'j1' } } as never);
    expect(await startInstrumental('t1', 'fast')).toBe('j1');
    expect(post).toHaveBeenCalledWith('/api/music/t1/instrumental', { quality: 'fast' });
  });

  it('keep returns the new track', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { ok: true, track: { id: 'n', label: 'Song (instrumental)' } } } as never);
    expect((await keepInstrumental('j1')).label).toBe('Song (instrumental)');
  });
});
