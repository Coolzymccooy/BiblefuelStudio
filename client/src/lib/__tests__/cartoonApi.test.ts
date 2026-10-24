import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

import { api } from '../api';
import { isApiError } from '../apiError';
import { cartoonApi } from '../cartoonApi';

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to reject');
}

describe('cartoonApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create sends exampleId and returns the project', async () => {
    const made = { id: 'c1', mode: 'cartoon', shots: [{ id: 'sh1', clip: null }] };
    vi.mocked(api.post).mockResolvedValue({ ok: true, status: 201, data: { ok: true, project: made } } as never);

    const result = await cartoonApi.create({ exampleId: 'lost-lamb' });

    expect(api.post).toHaveBeenCalledWith('/api/cartoon', { exampleId: 'lost-lamb' }, undefined, expect.objectContaining({ timeout: expect.any(Number) }));
    expect(result).toBe(made);
  });

  it('a 409 BUDGET becomes an ApiError with code BUDGET and the server sentence', async () => {
    const sentence = 'This film would take you over the $60 monthly limit.';
    vi.mocked(api.post).mockResolvedValue({
      ok: false, status: 409, error: 'Request failed with status code 409', data: { ok: false, code: 'BUDGET', error: sentence },
    } as never);

    const err = await rejection(cartoonApi.film('c1'));

    expect(isApiError(err)).toBe(true);
    expect(err).toMatchObject({ code: 'BUDGET', message: sentence, status: 409 });
  });

  it('a NOT_READY 409 keeps its blockers reachable on the error', async () => {
    const blockers = ['1 shot has no clip yet. Film it first.', 'The music bed can\'t be found.'];
    vi.mocked(api.post).mockResolvedValue({
      ok: false, status: 409, data: { ok: false, code: 'NOT_READY', error: blockers[0], blockers },
    } as never);

    const err = await rejection(cartoonApi.render('c1'));

    expect(isApiError(err)).toBe(true);
    expect(err).toMatchObject({ code: 'NOT_READY', message: blockers[0], payload: { blockers } });
  });

  it('URL-encodes a character name with a space in approvePortrait', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, status: 200, data: { ok: true, project: { id: 'c1' } } } as never);

    await cartoonApi.approvePortrait('c1', 'Little Eli');

    expect(api.post).toHaveBeenCalledWith('/api/cartoon/c1/cast/Little%20Eli/approve', {});
  });

  it('falls back to a plain sentence when the server sends no body', async () => {
    vi.mocked(api.get).mockResolvedValue({ ok: false, status: 0, error: 'Network Error' } as never);

    const err = await rejection(cartoonApi.list());

    expect(err).toMatchObject({ code: '', message: 'Network Error' });
  });
});
