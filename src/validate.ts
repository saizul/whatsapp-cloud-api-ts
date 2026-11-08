import { WhatsAppValidationError } from "./errors.js";
import type { ButtonsInput, ListInput, MediaRef } from "./types.js";

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

export function assertButtons(input: ButtonsInput): void {
  nonEmpty(input.body, "body");
  max(input.body, LIMITS.interactiveBody, "body");
  max(input.header, LIMITS.interactiveHeader, "header");
  max(input.footer, LIMITS.interactiveFooter, "footer");
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
  nonEmpty(input.body, "body");
  max(input.body, LIMITS.interactiveBody, "body");
  max(input.header, LIMITS.interactiveHeader, "header");
  max(input.footer, LIMITS.interactiveFooter, "footer");
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
