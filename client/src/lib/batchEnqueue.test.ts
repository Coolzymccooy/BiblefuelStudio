import { describe, it, expect, vi } from 'vitest';
import { enqueueBatch, reportBatch } from './batchEnqueue';
import { isApiError } from './apiError';

const okResponse = { ok: true, status: 200, data: { ok: true, job: { id: 'job_1' } } };
const quotaResponse = {
    ok: false,
    status: 429,
    error: 'QUOTA_EXCEEDED',
    data: { ok: false, error: 'QUOTA_EXCEEDED', bucket: 'render', used: 5, limit: 5, hint: 'Upgrade to Premium.' },
};

describe('enqueueBatch', () => {
    it('queues every item when each call succeeds', async () => {
        const send = vi.fn().mockResolvedValue(okResponse);
        const outcome = await enqueueBatch(['a', 'b', 'c'], send);
        expect(send).toHaveBeenCalledTimes(3);
        expect(outcome).toMatchObject({ total: 3, queued: 3, failed: 0, stoppedBy: null });
    });

    it('stops at the first QUOTA_EXCEEDED and sends nothing after it', async () => {
        const send = vi.fn()
            .mockResolvedValueOnce(okResponse)
            .mockResolvedValueOnce(quotaResponse)
            .mockResolvedValue(okResponse);
        const outcome = await enqueueBatch(['a', 'b', 'c', 'd'], send);
        expect(send).toHaveBeenCalledTimes(2);
        expect(outcome.queued).toBe(1);
        expect(outcome.stoppedBy?.code).toBe('QUOTA_EXCEEDED');
        expect(outcome.stoppedBy?.payload.hint).toBe('Upgrade to Premium.');
    });

    it('stops at any 429, even without the quota code', async () => {
        const send = vi.fn().mockResolvedValue({ ok: false, status: 429, error: 'Too many requests', data: {} });
        const outcome = await enqueueBatch(['a', 'b'], send);
        expect(send).toHaveBeenCalledTimes(1);
        expect(outcome.stoppedBy?.status).toBe(429);
    });

    it('counts other failures and carries on', async () => {
        const send = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 400, error: 'bad payload', data: { error: 'bad payload' } })
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(okResponse);
        const outcome = await enqueueBatch(['a', 'b', 'c'], send);
        expect(outcome).toMatchObject({ total: 3, queued: 1, failed: 2, stoppedBy: null, firstError: 'bad payload' });
    });
});

function toasts() {
    return { success: vi.fn(), error: vi.fn(), apiError: vi.fn() };
}

describe('reportBatch', () => {
    it('reports a full batch as success', () => {
        const t = toasts();
        reportBatch({ total: 2, queued: 2, failed: 0, stoppedBy: null, firstError: null }, t);
        expect(t.success).toHaveBeenCalledWith('Queued 2 render jobs.');
        expect(t.error).not.toHaveBeenCalled();
        expect(t.apiError).not.toHaveBeenCalled();
    });

    it('shows the quota error with its hint, the way HomePage does, and never a zero success', () => {
        const t = toasts();
        reportBatch({ total: 3, queued: 0, failed: 0, stoppedBy: { code: 'QUOTA_EXCEEDED', status: 429, payload: quotaResponse.data }, firstError: null }, t);
        expect(t.success).not.toHaveBeenCalled();
        const [err] = t.apiError.mock.calls[0];
        expect(isApiError(err)).toBe(true);
        expect(err.code).toBe('QUOTA_EXCEEDED');
        expect(err.payload.hint).toBe('Upgrade to Premium.');
        expect(t.error).toHaveBeenCalledWith('No render jobs were queued.');
    });

    it('reports a batch cut short by the quota as partial', () => {
        const t = toasts();
        reportBatch({ total: 4, queued: 1, failed: 0, stoppedBy: { code: 'QUOTA_EXCEEDED', status: 429, payload: quotaResponse.data }, firstError: null }, t);
        expect(t.apiError).toHaveBeenCalledTimes(1);
        expect(t.success).toHaveBeenCalledWith('Queued 1 of 4 render jobs; the rest were not sent.');
    });

    it('reports failures honestly: none queued is an error, some queued is partial', () => {
        const none = toasts();
        reportBatch({ total: 2, queued: 0, failed: 2, stoppedBy: null, firstError: 'bad payload' }, none);
        expect(none.success).not.toHaveBeenCalled();
        expect(none.error).toHaveBeenCalledWith('No render jobs were queued: bad payload');
        const some = toasts();
        reportBatch({ total: 3, queued: 2, failed: 1, stoppedBy: null, firstError: 'bad payload' }, some);
        expect(some.success).toHaveBeenCalledWith('Queued 2 of 3 render jobs.');
        expect(some.error).toHaveBeenCalledWith('1 could not be queued: bad payload');
    });
});
