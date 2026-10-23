import { describe, it, expect, vi } from 'vitest';

vi.mock('../api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));

import { api } from '../api';
import { visualLibraryApi, IMPORT_TIMEOUT_MS } from '../sceneScriptApi';

describe('visualLibraryApi.importClip', () => {
  it('waits long enough for the server to convert a clip', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, status: 200, data: { clip: { id: 'c1' } } } as never);
    await visualLibraryApi.importClip({ uploadPath: 'bg-video-x.mp4', prompt: 'Hills' });
    expect(api.post).toHaveBeenCalledWith('/api/visual-library/import', { uploadPath: 'bg-video-x.mp4', prompt: 'Hills' }, undefined, { timeout: IMPORT_TIMEOUT_MS });
    expect(IMPORT_TIMEOUT_MS).toBeGreaterThanOrEqual(140_000);
  });
});
