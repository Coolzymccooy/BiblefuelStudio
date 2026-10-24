import { signInternalToken } from "../auth.js";

/**
 * Loopback client for MCP tool handlers: calls the app's own HTTP API as the
 * agent's user, so every route middleware (scope, quota, verified email,
 * super-admin gates) runs unchanged. A fresh 60-second internal token is
 * minted for each call.
 */

const ERROR_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

export class ApiError extends Error {
  /**
   * @param {{ status: number, code: string, message: string, hint?: string | null }} details
   */
  constructor({ status, code, message, hint = null }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

function queryString(query) {
  if (!query || typeof query !== "object") return "";
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.append(name, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toApiError(status, statusText, body) {
  const error = typeof body?.error === "string" ? body.error : null;
  const hint = typeof body?.hint === "string" ? body.hint : null;
  const isCode = Boolean(error && ERROR_CODE.test(error));
  const code = isCode ? error : `HTTP_${status}`;
  // A code is not a sentence: prefer the route's hint as the readable message.
  const readable = isCode ? hint || error : error || hint;
  return new ApiError({ status, code, message: readable || statusText || `HTTP ${status}`, hint });
}

/**
 * @param {{ user: { sub: string, email: string, role: string, emailVerified?: boolean }, baseUrl: string }} options
 */
export function createApi({ user, baseUrl }) {
  /**
   * @param {"GET"|"POST"|"PUT"|"PATCH"|"DELETE"} method
   * @param {string} path e.g. "/api/billing/usage"
   * @param {{ body?: unknown, query?: Record<string, unknown> }} [options]
   */
  async function call(method, path, { body, query } = {}) {
    const headers = { Authorization: `Bearer ${signInternalToken(user)}`, Accept: "application/json" };
    const init = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await fetch(`${baseUrl}${path}${queryString(query)}`, init);
    const parsed = await readBody(response);
    if (!response.ok) throw toApiError(response.status, response.statusText, parsed);
    return parsed;
  }

  return { call };
}
