import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, timelineApi } from '../api';

const project = { id: 'p1' };
const ok = { ok: true, status: 200, data: { ok: true } } as any;

beforeEach(() => { vi.restoreAllMocks(); });

describe('timelineApi.render', () => {
  it('sends energy and seed alongside the Studio look when given', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue(ok);
    await timelineApi.render(project, 'proof_720p', 'studio-lagos-night', { captionEnergy: 'lively', captionSeed: 42 });
    expect(spy.mock.calls[0][0]).toBe('/api/timeline/render');
    expect(spy.mock.calls[0][1]).toEqual({
      project, quality: 'proof_720p', typographyPreset: 'studio-lagos-night', captionEnergy: 'lively', captionSeed: 42,
    });
  });

  it('leaves the body unchanged when no studio argument is given', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue(ok);
    await timelineApi.render(project, 'proof_720p', 'marker');
    const body = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(body).toEqual({ project, quality: 'proof_720p', typographyPreset: 'marker' });
    expect(body).not.toHaveProperty('captionEnergy');
    expect(body).not.toHaveProperty('captionSeed');
  });
});
