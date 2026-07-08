import {
    api,
    UPLOAD_TIMEOUT_MS,
    MEDIA_OP_TIMEOUT_MS,
    DIRECT_UPLOAD_MAX_BYTES,
    RESUMABLE_UPLOAD_MAX_BYTES,
} from './api';
import { resumableUploadToSession } from './resumableUpload';

export type UploadKind = 'audio' | 'source-video' | 'background';

export interface UploadResult {
    /** Server-side local path the pipeline consumes. */
    file: string;
    /** Background uploads only: whether the clip is an image or a video. */
    kind?: 'image' | 'video';
    /** Background videos only: URL of the first-frame poster. */
    thumb?: string;
    mime?: string;
}

const DIRECT_ENDPOINT: Record<UploadKind, string> = {
    audio: '/api/media/upload-audio',
    'source-video': '/api/media/upload-source-video',
    background: '/api/media/upload-background',
};

function mb(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(0);
}

async function resumable(file: Blob, filename: string, kind: UploadKind, onProgress?: (pct: number) => void): Promise<UploadResult> {
    const contentType = (file as File).type || 'application/octet-stream';
    const session = await api.post<{ sessionUrl: string; objectPath: string }>(
        '/api/media/upload-session',
        { filename, contentType, size: file.size, kind },
    );
    if (!session.ok || !session.data?.sessionUrl || !session.data?.objectPath) {
        throw new Error(session.error || 'Large uploads are not available on this server right now.');
    }

    await resumableUploadToSession(session.data.sessionUrl, file, { onProgress });

    const finalized = await api.post<UploadResult>(
        '/api/media/upload-finalize',
        { objectPath: session.data.objectPath, filename, contentType, kind },
        undefined,
        { timeout: MEDIA_OP_TIMEOUT_MS },
    );
    if (!finalized.ok || !finalized.data?.file) throw new Error(finalized.error || 'Finalizing upload failed');
    return finalized.data;
}

/**
 * Upload a media file, choosing transport by size: files at/under the direct
 * cap use the fast one-shot uploadRaw; larger ones (which Cloudflare would
 * reject) go resumable → storage and survive mobile drops. Returns the same
 * shape the corresponding server endpoint returns, so call-sites are identical
 * regardless of which transport ran.
 */
export async function uploadMedia(
    file: Blob,
    filename: string,
    kind: UploadKind,
    onProgress?: (pct: number) => void,
): Promise<UploadResult> {
    if (file.size > RESUMABLE_UPLOAD_MAX_BYTES) {
        throw new Error(`File is ${mb(file.size)} MB. The maximum is ${mb(RESUMABLE_UPLOAD_MAX_BYTES)} MB.`);
    }
    if (file.size > DIRECT_UPLOAD_MAX_BYTES) {
        return resumable(file, filename, kind, onProgress);
    }
    const res = await api.uploadRaw<UploadResult>(DIRECT_ENDPOINT[kind], file, {
        filename,
        timeout: UPLOAD_TIMEOUT_MS,
        onUploadProgress: onProgress,
    });
    if (!res.ok || !res.data?.file) throw new Error(res.error || 'Upload failed');
    return res.data;
}
