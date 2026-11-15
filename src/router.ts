import { WhatsAppError } from "./errors.js";
import { parseWebhook } from "./webhook.js";
import type {
  ErrorEvent,
  IncomingMessage,
  MessageEvent,
  MessageStatusValue,
  StatusEvent,
  WebhookEvent,
} from "./webhook-types.js";

/**
 * Remembers which webhook events were already handled. Meta delivers webhooks
 * at least once and retries for up to several days, so the same message or
 * status can arrive more than once. Implement this over Redis, a database or
 * similar to share state between processes; `MemoryDedupeStore` is the
 * single-process default.
 */
export interface DedupeStore {
  /**
   * Atomically record `key` if it is not present. Resolve `true` when the key
   * was newly recorded and `false` when it was already there (a duplicate).
   */
  claim(key: string, ttlMs: number): boolean | Promise<boolean>;
  /** Forget `key`, so a later redelivery is handled again. */
  release(key: string): void | Promise<void>;
}

export interface MemoryDedupeStoreOptions {
  /** Maximum number of keys kept; the oldest are evicted first. Default 10 000. */
  maxEntries?: number;
  /** Clock in milliseconds, injectable for tests. */
  now?: () => number;
}

/** In-process `DedupeStore` with per-key expiry and a size cap. */
export class MemoryDedupeStore implements DedupeStore {
  readonly #entries = new Map<string, number>();
  readonly #maxEntries: number;
  readonly #now: () => number;

  constructor(options: MemoryDedupeStoreOptions = {}) {
    const max = options.maxEntries ?? 10_000;
    if (!Number.isInteger(max) || max < 1) {
      throw new WhatsAppError("maxEntries must be a positive integer");
    }
    this.#maxEntries = max;
    this.#now = options.now ?? Date.now;
  }

  /** Number of live (unexpired) keys. */
  get size(): number {
    this.#sweep();
    return this.#entries.size;
  }

  claim(key: string, ttlMs: number): boolean {
    const now = this.#now();
    const expires = this.#entries.get(key);
    if (expires !== undefined && expires > now) return false;
    // Re-insert so Map order tracks recency for eviction.
    this.#entries.delete(key);
    this.#entries.set(key, now + ttlMs);
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value as string;
      this.#entries.delete(oldest);
    }
    return true;
  }

  release(key: string): void {
    this.#entries.delete(key);
  }

  /** Drop every key. */
  clear(): void {
    this.#entries.clear();
  }

  #sweep(): void {
    const now = this.#now();
    for (const [key, expires] of this.#entries) {
      if (expires <= now) this.#entries.delete(key);
    }
  }
}

export type MessageHandler = (event: MessageEvent) => unknown | Promise<unknown>;
export type StatusHandler = (event: StatusEvent) => unknown | Promise<unknown>;
export type ErrorEventHandler = (event: ErrorEvent) => unknown | Promise<unknown>;

export interface WebhookRouterOptions {
  /**
   * Store used to skip redelivered events. Defaults to a fresh
   * `MemoryDedupeStore`; pass `false` to disable deduplication.
   */
  dedupe?: DedupeStore | false;
  /** How long a handled event id is remembered. Default 24 hours. */
  dedupeTtlMs?: number;
  /**
   * Skip messages and statuses whose `timestamp` is older than this many
   * seconds (for example after a long outage, when replies would be stale).
   * Disabled by default.
   */
  maxAgeSeconds?: number;
  /** Clock in milliseconds, injectable for tests. */
  now?: () => number;
}

export type DispatchOutcome = "handled" | "duplicate" | "stale" | "unhandled" | "failed";

export interface DispatchFailure {
  event: WebhookEvent;
  error: unknown;
}

export interface DispatchResult {
  /** Events at least one handler ran for without throwing. */
  handled: number;
  /** Events skipped because the dedupe store had already seen them. */
  duplicates: number;
  /** Events skipped because they were older than `maxAgeSeconds`. */
  stale: number;
  /** Events no handler was registered for. */
  unhandled: number;
  /** Events where a handler threw; the dedupe key is released so a retry is handled. */
  failures: DispatchFailure[];
  /** Per-event outcome, in input order. */
  outcomes: DispatchOutcome[];
}

type AnyHandler = (event: WebhookEvent) => unknown;

const DAY_MS = 24 * 60 * 60 * 1000;

type MessageType = IncomingMessage["type"];

/** Key used for deduplication, or `undefined` when an event has no stable id. */
export function eventDedupeKey(event: WebhookEvent): string | undefined {
  switch (event.kind) {
    case "message":
      return event.message.id ? `message:${event.message.id}` : undefined;
    case "status":
      // A message moves through sent -> delivered -> read; each is its own event.
      return event.status.id ? `status:${event.status.id}:${event.status.status}` : undefined;
    default:
      return undefined;
  }
}

function eventTimestamp(event: WebhookEvent): number | undefined {
  const raw = event.kind === "message" ? event.message.timestamp : event.kind === "status" ? event.status.timestamp : undefined;
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/**
 * Dispatch parsed webhook events to handlers by message type or status, with
 * redelivery deduplication and optional stale-event filtering.
 *
 * ```ts
 * const router = new WebhookRouter({ maxAgeSeconds: 600 })
 *   .onMessage("text", async ({ message }) => { ... })
 *   .onStatus("failed", ({ status }) => log(status.errors));
 * const result = await router.dispatch(verifyAndParse(raw, sig, secret));
 * ```
 */
export class WebhookRouter {
  readonly #messageHandlers = new Map<string, MessageHandler[]>();
  readonly #statusHandlers = new Map<string, StatusHandler[]>();
  readonly #errorHandlers: ErrorEventHandler[] = [];
  readonly #dedupe: DedupeStore | undefined;
  readonly #ttlMs: number;
  readonly #maxAgeSeconds: number | undefined;
  readonly #now: () => number;

  constructor(options: WebhookRouterOptions = {}) {
    const ttl = options.dedupeTtlMs ?? DAY_MS;
    if (!Number.isFinite(ttl) || ttl <= 0) throw new WhatsAppError("dedupeTtlMs must be a positive number");
    const maxAge = options.maxAgeSeconds;
    if (maxAge !== undefined && (!Number.isFinite(maxAge) || maxAge <= 0)) {
      throw new WhatsAppError("maxAgeSeconds must be a positive number");
    }
    this.#now = options.now ?? Date.now;
    this.#dedupe = options.dedupe === false ? undefined : (options.dedupe ?? new MemoryDedupeStore({ now: this.#now }));
    this.#ttlMs = ttl;
    this.#maxAgeSeconds = maxAge;
  }

  /** Register a handler for one message type (`"text"`, `"image"`, ...), or `"*"` for all. */
  onMessage(type: MessageType | "*", handler: MessageHandler): this;
  /** Register a handler for every inbound message. */
  onMessage(handler: MessageHandler): this;
  onMessage(typeOrHandler: MessageType | "*" | MessageHandler, maybeHandler?: MessageHandler): this {
    const [key, handler] = typeof typeOrHandler === "function" ? ["*", typeOrHandler] : [typeOrHandler, maybeHandler];
    if (typeof handler !== "function") throw new WhatsAppError("onMessage requires a handler function");
    push(this.#messageHandlers, key, handler);
    return this;
  }

  /** Register a handler for one status value (`"delivered"`, `"failed"`, ...), or `"*"` for all. */
  onStatus(status: MessageStatusValue | "*", handler: StatusHandler): this;
  /** Register a handler for every status update. */
  onStatus(handler: StatusHandler): this;
  onStatus(statusOrHandler: MessageStatusValue | "*" | StatusHandler, maybeHandler?: StatusHandler): this {
    const [key, handler] =
      typeof statusOrHandler === "function" ? ["*", statusOrHandler] : [statusOrHandler, maybeHandler];
    if (typeof handler !== "function") throw new WhatsAppError("onStatus requires a handler function");
    push(this.#statusHandlers, key, handler);
    return this;
  }

  /** Register a handler for value-level `errors` events. These are never deduplicated. */
  onError(handler: ErrorEventHandler): this {
    if (typeof handler !== "function") throw new WhatsAppError("onError requires a handler function");
    this.#errorHandlers.push(handler);
    return this;
  }

  /**
   * Run handlers for a list of events, or for a raw (already JSON-parsed)
   * webhook payload. Events are processed in order; handlers for one event run
   * in registration order (specific before `"*"`). A throwing handler does not
   * stop the rest; the failure is reported in the result so you can answer
   * with a non-2xx status and let Meta retry.
   */
  async dispatch(input: WebhookEvent[] | unknown): Promise<DispatchResult> {
    const events = Array.isArray(input) ? (input as WebhookEvent[]) : parseWebhook(input);
    const result: DispatchResult = { handled: 0, duplicates: 0, stale: 0, unhandled: 0, failures: [], outcomes: [] };
    for (const event of events) {
      const outcome = await this.#dispatchOne(event, result.failures);
      result.outcomes.push(outcome);
      if (outcome === "handled") result.handled++;
      else if (outcome === "duplicate") result.duplicates++;
      else if (outcome === "stale") result.stale++;
      else if (outcome === "unhandled") result.unhandled++;
    }
    return result;
  }

  async #dispatchOne(event: WebhookEvent, failures: DispatchFailure[]): Promise<DispatchOutcome> {
    const handlers = this.#handlersFor(event);
    if (handlers.length === 0) return "unhandled";

    if (this.#maxAgeSeconds !== undefined) {
      const ts = eventTimestamp(event);
      if (ts !== undefined && this.#now() / 1000 - ts > this.#maxAgeSeconds) return "stale";
    }

    const key = this.#dedupe ? eventDedupeKey(event) : undefined;
    if (key !== undefined && !(await this.#dedupe!.claim(key, this.#ttlMs))) return "duplicate";

    let failed = false;
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        failed = true;
        failures.push({ event, error });
      }
    }
    if (failed) {
      if (key !== undefined) await this.#dedupe!.release(key);
      return "failed";
    }
    return "handled";
  }

  #handlersFor(event: WebhookEvent): AnyHandler[] {
    return this.#lookup(event) as AnyHandler[];
  }

  #lookup(event: WebhookEvent): (MessageHandler | StatusHandler | ErrorEventHandler)[] {
    switch (event.kind) {
      case "message":
        return [...(this.#messageHandlers.get(event.message.type) ?? []), ...(this.#messageHandlers.get("*") ?? [])];
      case "status":
        return [...(this.#statusHandlers.get(event.status.status) ?? []), ...(this.#statusHandlers.get("*") ?? [])];
      case "error":
        return [...this.#errorHandlers];
      default:
        return [];
    }
  }
}

function push<H>(map: Map<string, H[]>, key: string, handler: H): void {
  const list = map.get(key);
  if (list) list.push(handler);
  else map.set(key, [handler]);
}
