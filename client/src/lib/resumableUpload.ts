// Resumable upload straight to a Google Cloud Storage session URL (minted by
// our server). This bypasses Cloudflare's 100 MB request-body cap and, by
// uploading in committed chunks, survives a dropped mobile connection — a
// failed chunk resumes from the last byte GCS actually committed instead of
// restarting the whole file.
//
// We use XMLHttpRequest (not fetch) for two reasons: native upload-progress
// events, and readable `308 Resume Incomplete` responses (fetch's redirect
// handling makes 308 awkward). The bucket's CORS config must expose the `Range`
// response header for resume to work.

// GCS requires every non-final chunk to be a multiple of 256 KiB.
const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB = 32 × 256 KiB
const MAX_STALLS = 5; // consecutive failures / no-progress rounds before giving up

export interface ResumableUploadOptions {
    /** Overall progress, 0..100. */
    onProgress?: (percent: number) => void;
    /** Abort the in-flight upload. */
    signal?: AbortSignal;
    chunkSize?: number;
}

interface ChunkResult {
    status: number;
    /** Last byte index GCS has committed (from the `Range` header on a 308). */
    committedEnd: number | null;
}

function parseRangeEnd(rangeHeader: string | null): number | null {
    // GCS returns e.g. "bytes=0-8388607" — the number after the dash is the
    // last byte it has committed.
    const m = /bytes=\d+-(\d+)/.exec(String(rangeHeader || ''));
    return m ? Number(m[1]) : null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
}

/** PUT one chunk (or a status query when `chunk` is null). Resolves with the
 *  HTTP status and any committed-byte hint; rejects on network/abort error. */
function putChunk(
    sessionUrl: string,
    chunk: Blob | null,
    startByte: number,
    total: number,
    onLoaded: (loadedInChunk: number) => void,
    signal?: AbortSignal,
): Promise<ChunkResult> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', sessionUrl, true);

        if (chunk == null) {
            // Status query: ask how many bytes GCS has committed so far.
            xhr.setRequestHeader('Content-Range', `bytes */${total}`);
        } else {
            const endByte = startByte + chunk.size - 1;
            xhr.setRequestHeader('Content-Range', `bytes ${startByte}-${endByte}/${total}`);
        }

        const onAbort = () => xhr.abort();
        if (signal) {
            if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
            signal.addEventListener('abort', onAbort, { once: true });
        }
        const cleanup = () => signal?.removeEventListener('abort', onAbort);

        if (chunk) {
            xhr.upload.onprogress = (e) => { if (e.lengthComputable) onLoaded(e.loaded); };
        }
        xhr.onload = () => {
            cleanup();
            resolve({ status: xhr.status, committedEnd: parseRangeEnd(xhr.getResponseHeader('Range')) });
        };
        xhr.onerror = () => { cleanup(); reject(new Error('Network error during upload')); };
        xhr.ontimeout = () => { cleanup(); reject(new Error('Upload chunk timed out')); };
        xhr.onabort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };

        xhr.send(chunk);
    });
}

/** Ask GCS how many bytes it has committed for this session (0 if none, total if done). */
async function queryCommittedOffset(sessionUrl: string, total: number, signal?: AbortSignal): Promise<number> {
    const r = await putChunk(sessionUrl, null, 0, total, () => {}, signal);
    if (r.status === 200 || r.status === 201) return total; // already complete
    if (r.status === 308) return r.committedEnd != null ? r.committedEnd + 1 : 0;
    throw new Error(`Unexpected status querying upload: ${r.status}`);
}

/**
 * Upload `file` to a GCS resumable `sessionUrl` in chunks, resuming on failure.
 * Resolves when GCS accepts the whole object (status 200/201); rejects on abort
 * or after too many stalled rounds. Progress is reported as an overall 0..100.
 */
export async function resumableUploadToSession(
    sessionUrl: string,
    file: Blob,
    opts: ResumableUploadOptions = {},
): Promise<void> {
    const total = file.size;
    const chunkSize = opts.chunkSize ?? CHUNK_SIZE;
    const report = (uploaded: number) => opts.onProgress?.(total ? Math.min(100, Math.round((uploaded / total) * 100)) : 100);

    let offset = 0;
    let stalls = 0;

    while (offset < total) {
        const end = Math.min(offset + chunkSize, total);
        const chunk = file.slice(offset, end);
        const base = offset;

        try {
            const result = await putChunk(sessionUrl, chunk, offset, total, (loaded) => report(base + loaded), opts.signal);

            if (result.status === 200 || result.status === 201) { report(total); return; }

            if (result.status === 308) {
                const next = result.committedEnd != null ? result.committedEnd + 1 : end;
                if (next > offset) { offset = next; stalls = 0; }
                else { stalls += 1; if (stalls > MAX_STALLS) throw new Error('Upload stalled (no progress)'); }
                report(offset);
                continue;
            }

            throw new Error(`Upload failed with HTTP ${result.status}`);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') throw err;
            stalls += 1;
            if (stalls > MAX_STALLS) throw err instanceof Error ? err : new Error('Upload failed');
            await sleep(Math.min(1000 * 2 ** (stalls - 1), 8000), opts.signal);
            // Re-sync to what GCS committed, then resume — but only ever FORWARD.
            // `offset` already tracks bytes GCS confirmed via prior 308s, so if
            // the `Range` header is unreadable (CORS) and the query reports 0, we
            // keep our confirmed offset instead of restarting the whole file.
            try {
                const committed = await queryCommittedOffset(sessionUrl, total, opts.signal);
                if (committed >= total) { report(total); return; }
                offset = Math.max(offset, committed);
                report(offset);
            } catch (e) {
                if (e instanceof DOMException && e.name === 'AbortError') throw e;
                // Keep current offset and retry the same chunk on the next round.
            }
        }
    }
    report(total);
}
