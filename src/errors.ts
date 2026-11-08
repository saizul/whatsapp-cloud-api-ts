/** Shape of the `error` object Graph API returns on failures. */
export interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
  error_data?: { messaging_product?: string; details?: string };
}

/** Base class for every error thrown by this library. */
export class WhatsAppError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Thrown before any request is made when input fails local validation. */
export class WhatsAppValidationError extends WhatsAppError {}

/** Thrown when the request could not complete (DNS, connection reset, timeout). */
export class WhatsAppNetworkError extends WhatsAppError {}

/** Thrown when the Graph API answers with a non-2xx status. */
export class WhatsAppApiError extends WhatsAppError {
  /** HTTP status code. */
  readonly status: number;
  /** Graph API error code (e.g. 190 invalid token, 131030 recipient not allowed). */
  readonly code: number | undefined;
  readonly subcode: number | undefined;
  /** Graph API error type (e.g. `OAuthException`). */
  readonly type: string | undefined;
  readonly fbtraceId: string | undefined;
  /** Extra human readable detail from `error_data.details`, when present. */
  readonly details: string | undefined;
  /** The parsed response body (or raw text when it was not JSON). */
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const err = extractGraphError(body);
    const text = err?.message ?? `Request failed with HTTP ${status}`;
    super(err?.code !== undefined ? `${text} (code ${err.code})` : text);
    this.status = status;
    this.code = err?.code;
    this.subcode = err?.error_subcode;
    this.type = err?.type;
    this.fbtraceId = err?.fbtrace_id;
    this.details = err?.error_data?.details;
    this.body = body;
  }

  /** True for HTTP 429 or the documented throughput / rate-limit codes. */
  get isRateLimited(): boolean {
    return this.status === 429 || (this.code !== undefined && RATE_LIMIT_CODES.has(this.code));
  }

  /** True when the access token is invalid or expired (code 190, or 401). */
  get isAuthError(): boolean {
    return this.status === 401 || this.code === 190;
  }

  /** True for 5xx responses and rate limits: safe to retry later. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.isRateLimited;
  }
}

/** Codes that indicate throttling: 4 (app), 17 (user), 80007 (WABA), 130429 (throughput), 131048 (spam). */
export const RATE_LIMIT_CODES: ReadonlySet<number> = new Set([4, 17, 80007, 130429, 131048]);

/** Pull the `error` object out of an arbitrary parsed body. */
export function extractGraphError(body: unknown): GraphErrorBody | undefined {
  if (typeof body === "object" && body !== null && "error" in body) {
    const e = (body as { error: unknown }).error;
    if (typeof e === "object" && e !== null) return e as GraphErrorBody;
  }
  return undefined;
}
