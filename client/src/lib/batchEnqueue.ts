import { ApiError } from './apiError';
import type { ApiResponse } from './api';

/**
 * Queue page "Batch Render": send one enqueue per item, in order, and say
 * honestly what happened. A plan quota refusal (QUOTA_EXCEEDED, or any 429)
 * stops the batch at once: every later item would be refused the same way.
 */

export interface BatchStop {
    code: string;
    status: number;
    payload: Record<string, unknown>;
}

export interface BatchOutcome {
    total: number;
    queued: number;
    failed: number;
    /** The quota refusal that ended the batch early, or null. */
    stoppedBy: BatchStop | null;
    /** The first other failure's message, or null. */
    firstError: string | null;
}

export interface BatchToasts {
    success: (message: string) => void;
    error: (message: string) => void;
    /** Shows a structured error the friendly way (toastError). */
    apiError: (err: ApiError) => void;
}

const isQuotaStop = (res: ApiResponse) => res.status === 429 || res.data?.error === 'QUOTA_EXCEEDED';

const plural = (n: number) => `${n} render job${n === 1 ? '' : 's'}`;

export async function enqueueBatch<T>(items: T[], send: (item: T) => Promise<ApiResponse>): Promise<BatchOutcome> {
    let queued = 0;
    let failed = 0;
    let firstError: string | null = null;
    for (const item of items) {
        let res: ApiResponse;
        try {
            res = await send(item);
        } catch (err) {
            failed += 1;
            firstError ??= err instanceof Error ? err.message : String(err);
            continue;
        }
        if (res.ok) {
            queued += 1;
            continue;
        }
        if (isQuotaStop(res)) {
            const payload = (res.data as Record<string, unknown>) || {};
            const code = String(payload.error || res.error || 'QUOTA_EXCEEDED');
            return { total: items.length, queued, failed, stoppedBy: { code, status: res.status, payload }, firstError };
        }
        failed += 1;
        firstError ??= String(res.error || res.data?.error || `HTTP ${res.status}`);
    }
    return { total: items.length, queued, failed, stoppedBy: null, firstError };
}

/** Toasts for one batch: a zero count is never shown as success. */
export function reportBatch(outcome: BatchOutcome, toasts: BatchToasts): void {
    const { total, queued, failed, stoppedBy, firstError } = outcome;
    if (stoppedBy) toasts.apiError(new ApiError(stoppedBy.code, stoppedBy.code, stoppedBy.payload, stoppedBy.status));
    if (queued === 0) {
        if (!stoppedBy) toasts.error(firstError ? `No render jobs were queued: ${firstError}` : 'No render jobs were queued.');
        else toasts.error('No render jobs were queued.');
        return;
    }
    if (queued === total) {
        toasts.success(`Queued ${plural(queued)}.`);
        return;
    }
    if (stoppedBy) {
        toasts.success(`Queued ${queued} of ${plural(total)}; the rest were not sent.`);
        return;
    }
    toasts.success(`Queued ${queued} of ${plural(total)}.`);
    if (failed > 0) toasts.error(`${failed} could not be queued${firstError ? `: ${firstError}` : '.'}`);
}
