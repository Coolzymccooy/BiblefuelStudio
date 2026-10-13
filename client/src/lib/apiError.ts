/**
 * Error wrapper that preserves the full server payload, not just the
 * top-level error string. Lets the UI render quota.bucket, quota.hint,
 * etc. instead of showing raw codes like "QUOTA_EXCEEDED".
 */
export class ApiError extends Error {
  code: string;
  payload: Record<string, unknown>;
  /** HTTP status when the error came from a response (absent for transport failures). */
  status?: number;

  constructor(message: string, code: string, payload: Record<string, unknown> = {}, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.payload = payload;
    this.status = status;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof Error && err.name === 'ApiError';
}
