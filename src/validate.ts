import { WhatsAppValidationError } from "./errors.js";
import type {
  ButtonsInput,
  CtaUrlInput,
  InteractiveHeader,
  ListInput,
  LocationRequestInput,
  MediaRef,
} from "./types.js";

/**
 * Local limits. They mirror the documented Cloud API limits at the time of
 * writing; Meta may change them. Disable with `validate: false` on the client.
 */
export const LIMITS = {
  textBody: 4096,
  caption: 1024,
  interactiveBody: 1024,
  interactiveHeader: 60,
  interactiveFooter: 60,
  buttonCount: 3,
  buttonTitle: 20,
  buttonId: 256,
  listButtonText: 20,
  listRowsTotal: 10,
  listSections: 10,
  rowTitle: 24,
  rowDescription: 72,
  rowId: 200,
  sectionTitle: 24,
  ctaDisplayText: 20,
  emoji: 16,
} as const;

function fail(msg: string): never {
  throw new WhatsAppValidationError(msg);
}

export function assertRecipient(to: string): void {
  if (typeof to !== "string" || !/^\+?\d{6,20}$/.test(to.trim())) {
    fail("`to` must be a phone number in international format using digits only (e.g. 8801XXXXXXXXX)");
  }
}

export function normalizeRecipient(to: string): string {
  return to.trim().replace(/^\+/, "");
}

function nonEmpty(value: unknown, name: string): void {
  if (typeof value !== "string" || value.trim() === "") fail(`${name} must be a non-empty string`);
}

function max(value: string | undefined, limit: number, name: string): void {
  if (value !== undefined && [...value].length > limit) fail(`${name} must be at most ${limit} characters`);
}

export function assertText(body: string): void {
  nonEmpty(body, "text body");
  max(body, LIMITS.textBody, "text body");
}

export function assertMediaRef(ref: MediaRef): void {
  const hasId = typeof ref?.id === "string" && ref.id !== "";
  const hasLink = typeof ref?.link === "string" && ref.link !== "";
  if (hasId === hasLink) fail("media must have exactly one of `id` or `link`");
  if (hasLink && !/^https:\/\//i.test(ref.link as string)) fail("media `link` must be an https URL");
}

export function assertCaption(caption: string | undefined): void {
  max(caption, LIMITS.caption, "caption");
}

const MEDIA_HEADER_TYPES = ["image", "video", "document"] as const;

/**
 * Validate an interactive header. Text headers are limited to 60 characters;
 * media headers need exactly one of `id` or an https `link`.
 */
export function assertInteractiveHeader(header: InteractiveHeader | undefined, allowMedia: boolean): void {
  // An empty string header is ignored (no header is sent), as before.
  if (header === undefined || header === "") return;
  if (typeof header === "string") {
    max(header, LIMITS.interactiveHeader, "header");
    return;
  }
  if (typeof header !== "object" || header === null) fail("header must be a string or a header object");
  if (header.type === "text") {
    nonEmpty(header.text, "header text");
    max(header.text, LIMITS.interactiveHeader, "header text");
    return;
  }
  if (!(MEDIA_HEADER_TYPES as readonly string[]).includes(header.type)) {
    fail(`header type must be one of text, ${MEDIA_HEADER_TYPES.join(", ")}`);
  }
  if (!allowMedia) fail("this message type only supports text headers");
  const ref = (header as Record<string, unknown>)[header.type] as (MediaRef & { filename?: unknown }) | undefined;
  if (typeof ref !== "object" || ref === null) fail(`${header.type} header needs a \`${header.type}\` media reference`);
  assertMediaRef(ref);
  if (header.type === "document" && ref.filename !== undefined && typeof ref.filename !== "string") {
    fail("document header filename must be a string");
  }
}

function assertInteractiveBody(body: string, footer: string | undefined): void {
  nonEmpty(body, "body");
  max(body, LIMITS.interactiveBody, "body");
  max(footer, LIMITS.interactiveFooter, "footer");
}

export function assertButtons(input: ButtonsInput): void {
  assertInteractiveBody(input.body, input.footer);
  assertInteractiveHeader(input.header, true);
  const n = input.buttons?.length ?? 0;
  if (n < 1 || n > LIMITS.buttonCount) fail(`buttons must contain 1 to ${LIMITS.buttonCount} items`);
  const ids = new Set<string>();
  for (const b of input.buttons) {
    nonEmpty(b.id, "button id");
    nonEmpty(b.title, "button title");
    max(b.id, LIMITS.buttonId, "button id");
    max(b.title, LIMITS.buttonTitle, "button title");
    if (ids.has(b.id)) fail(`duplicate button id "${b.id}"`);
    ids.add(b.id);
  }
}

export function assertList(input: ListInput): void {
  assertInteractiveBody(input.body, input.footer);
  assertInteractiveHeader(input.header, false);
  nonEmpty(input.buttonText, "buttonText");
  max(input.buttonText, LIMITS.listButtonText, "buttonText");
  const sections = input.sections ?? [];
  if (sections.length < 1 || sections.length > LIMITS.listSections) {
    fail(`sections must contain 1 to ${LIMITS.listSections} items`);
  }
  let total = 0;
  const ids = new Set<string>();
  for (const s of sections) {
    if (sections.length > 1) nonEmpty(s.title, "section title (required when there are several sections)");
    max(s.title, LIMITS.sectionTitle, "section title");
    for (const r of s.rows ?? []) {
      total++;
      nonEmpty(r.id, "row id");
      nonEmpty(r.title, "row title");
      max(r.id, LIMITS.rowId, "row id");
      max(r.title, LIMITS.rowTitle, "row title");
      max(r.description, LIMITS.rowDescription, "row description");
      if (ids.has(r.id)) fail(`duplicate row id "${r.id}"`);
      ids.add(r.id);
    }
  }
  if (total < 1 || total > LIMITS.listRowsTotal) fail(`lists support 1 to ${LIMITS.listRowsTotal} rows in total`);
}

export function assertCtaUrl(input: CtaUrlInput): void {
  assertInteractiveBody(input.body, input.footer);
  assertInteractiveHeader(input.header, true);
  nonEmpty(input.displayText, "displayText");
  max(input.displayText, LIMITS.ctaDisplayText, "displayText");
  nonEmpty(input.url, "url");
  let parsed: URL | undefined;
  try {
    parsed = new URL(input.url);
  } catch {
    /* handled below */
  }
  if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
    fail("url must be an absolute http(s) URL");
  }
}

export function assertLocationRequest(input: LocationRequestInput): void {
  nonEmpty(input?.body, "body");
  max(input.body, LIMITS.interactiveBody, "body");
}

export function assertReaction(messageId: string, emoji: string): void {
  nonEmpty(messageId, "messageId");
  // An empty string is allowed by the API and removes an existing reaction.
  if (typeof emoji !== "string") fail("emoji must be a string");
  max(emoji, LIMITS.emoji, "emoji");
}

export function assertLocation(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) fail("latitude must be between -90 and 90");
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) fail("longitude must be between -180 and 180");
}

export type MediaKind = "image" | "video" | "audio" | "document" | "sticker";

/**
 * Supported upload MIME types and maximum sizes in bytes, per media kind.
 * Mirrors Meta's documented media limits at the time of writing. Stickers are
 * limited to 100 KB when static and 500 KB when animated; the larger limit is
 * used here because the format alone cannot tell them apart.
 */
export const MEDIA_LIMITS: Record<MediaKind, { mimeTypes: readonly string[]; maxBytes: number }> = {
  image: { mimeTypes: ["image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024 },
  video: { mimeTypes: ["video/mp4", "video/3gpp"], maxBytes: 16 * 1024 * 1024 },
  audio: {
    mimeTypes: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"],
    maxBytes: 16 * 1024 * 1024,
  },
  document: {
    mimeTypes: [
      "text/plain",
      "application/pdf",
      "application/vnd.ms-powerpoint",
      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    maxBytes: 100 * 1024 * 1024,
  },
  sticker: { mimeTypes: ["image/webp"], maxBytes: 500 * 1024 },
};

function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0]!.trim().toLowerCase();
}

/**
 * Which kind of WhatsApp media a MIME type belongs to, or `undefined` when it is
 * not supported. Parameters such as `; codecs=opus` are ignored.
 * `image/webp` is reported as `sticker`, the only kind that accepts it.
 */
export function getMediaKind(mimeType: string): MediaKind | undefined {
  if (typeof mimeType !== "string") return undefined;
  const base = baseMimeType(mimeType);
  for (const kind of Object.keys(MEDIA_LIMITS) as MediaKind[]) {
    if (MEDIA_LIMITS[kind].mimeTypes.includes(base)) return kind;
  }
  return undefined;
}

/** Reject unsupported MIME types, empty files and files above the documented size limit. */
export function assertMediaUpload(mimeType: string, size: number): void {
  nonEmpty(mimeType, "mimeType");
  const kind = getMediaKind(mimeType);
  if (!kind) fail(`unsupported media type "${mimeType}"`);
  if (!Number.isFinite(size) || size <= 0) fail("media file must not be empty");
  const { maxBytes } = MEDIA_LIMITS[kind];
  if (size > maxBytes) {
    fail(`${kind} files must be at most ${maxBytes} bytes (got ${size})`);
  }
}
