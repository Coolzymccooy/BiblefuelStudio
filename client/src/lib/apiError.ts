/**
 * Error wrapper that preserves the full server payload, not just the
 * top-level error string. Lets the UI render quota.bucket, quota.hint,
 * etc. instead of showing raw codes like "QUOTA_EXCEEDED".
 */
export class ApiError extends Error {
  code: string;
  payload: Record<string, unknown>;

  constructor(message: string, code: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.payload = payload;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof Error && err.name === 'ApiError';
}
