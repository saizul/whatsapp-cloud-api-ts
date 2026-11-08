import { createHmac, timingSafeEqual } from "node:crypto";
import { WhatsAppError } from "./errors.js";
import type {
  ContactProfile,
  IncomingMessage,
  WebhookEvent,
  WebhookMetadata,
  WebhookPayload,
} from "./webhook-types.js";

export interface ChallengeResult {
  /** HTTP status to answer with. */
  status: 200 | 403 | 400;
  /** Response body: the challenge when verified, otherwise a short message. */
  body: string;
}

type QueryLike = URLSearchParams | Record<string, string | string[] | undefined> | string;

function getParam(query: QueryLike, key: string): string | undefined {
  if (typeof query === "string") return new URLSearchParams(query.replace(/^\?/, "")).get(key) ?? undefined;
  if (query instanceof URLSearchParams) return query.get(key) ?? undefined;
  const v = query[key];
  return Array.isArray(v) ? v[0] : v;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still burn comparable time, then report mismatch.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Handle the one-time `GET` verification request Meta sends when you
 * register a webhook. Accepts a query string, `URLSearchParams` or a parsed
 * query object (Express style, dotted keys such as `hub.mode`).
 */
export function verifyChallenge(query: QueryLike, verifyToken: string): ChallengeResult {
  const mode = getParam(query, "hub.mode");
  const token = getParam(query, "hub.verify_token");
  const challenge = getParam(query, "hub.challenge");
  if (mode === undefined || token === undefined || challenge === undefined) {
    return { status: 400, body: "Missing hub parameters" };
  }
  if (mode === "subscribe" && verifyToken !== "" && safeEqual(token, verifyToken)) {
    return { status: 200, body: challenge };
  }
  return { status: 403, body: "Forbidden" };
}

/**
 * Check the `X-Hub-Signature-256` header (`sha256=<hex>`) against the raw,
 * unparsed request body using your app secret. Comparison is timing safe.
 * Always pass the exact bytes received; re-serialised JSON will not match.
 */
export function verifySignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | string[] | undefined | null,
  appSecret: string,
): boolean {
  const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!header || !appSecret) return false;
  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(header.trim());
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(expected, (match[1] as string).toLowerCase());
}

/** Compute the header value Meta would send. Handy for tests and local tooling. */
export function signPayload(rawBody: string | Uint8Array, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

/**
 * Flatten a webhook payload into a list of typed events. Unknown shapes are
 * skipped rather than thrown on, so a Meta-side addition never crashes you.
 * Throws `WhatsAppError` only if the input is not an object.
 */
export function parseWebhook(payload: unknown): WebhookEvent[] {
  if (typeof payload !== "object" || payload === null) {
    throw new WhatsAppError("Webhook payload must be an object");
  }
  const body = payload as Partial<WebhookPayload>;
  if (body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) return [];

  const events: WebhookEvent[] = [];
  for (const entry of body.entry) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== "messages" || !change.value) continue;
      const value = change.value;
      const metadata: WebhookMetadata = value.metadata ?? { display_phone_number: "", phone_number_id: "" };
      const entryId = entry.id;
      const contacts: ContactProfile[] = value.contacts ?? [];

      for (const message of value.messages ?? []) {
        events.push({
          kind: "message",
          entryId,
          metadata,
          contact: contacts.find((c) => c.wa_id === message.from) ?? contacts[0],
          message,
        });
      }
      for (const status of value.statuses ?? []) {
        events.push({ kind: "status", entryId, metadata, status });
      }
      if (value.errors?.length) {
        events.push({ kind: "error", entryId, metadata, errors: value.errors });
      }
    }
  }
  return events;
}

/** Verify the signature and parse in one step. Throws on a bad signature or invalid JSON. */
export function verifyAndParse(
  rawBody: string | Uint8Array,
  signatureHeader: string | string[] | undefined | null,
  appSecret: string,
): WebhookEvent[] {
  if (!verifySignature(rawBody, signatureHeader, appSecret)) {
    throw new WhatsAppError("Invalid webhook signature");
  }
  const text = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new WhatsAppError("Webhook body is not valid JSON", { cause });
  }
  return parseWebhook(json);
}

/** Best-effort human text for any inbound message (text body, button/list title, caption, ...). */
export function getMessageText(message: IncomingMessage): string | undefined {
  const m = message as Record<string, unknown> & { type: string };
  switch (m.type) {
    case "text":
      return (m.text as { body: string }).body;
    case "button":
      return (m.button as { text: string }).text;
    case "interactive": {
      const i = m.interactive as { button_reply?: { title: string }; list_reply?: { title: string } };
      return i.button_reply?.title ?? i.list_reply?.title;
    }
    case "image":
    case "video":
    case "document":
      return (m[m.type] as { caption?: string }).caption;
    default:
      return undefined;
  }
}
