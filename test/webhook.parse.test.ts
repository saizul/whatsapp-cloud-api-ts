import { describe, expect, it } from "vitest";
import { getMessageText, parseWebhook, WhatsAppError } from "../src/index.js";
import type { IncomingMessage, MessageEvent, StatusEvent } from "../src/index.js";

const metadata = { display_phone_number: "15550001111", phone_number_id: "PNID" };

function envelope(value: Record<string, unknown>, field = "messages") {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA1", changes: [{ field, value: { messaging_product: "whatsapp", metadata, ...value } }] }],
  };
}

function msg(extra: Record<string, unknown>) {
  return { from: "8801700000000", id: "wamid.IN", timestamp: "1700000000", ...extra };
}

function one(m: Record<string, unknown>): MessageEvent {
  const events = parseWebhook(envelope({ contacts: [{ wa_id: "8801700000000", profile: { name: "Rahim" } }], messages: [msg(m)] }));
  expect(events).toHaveLength(1);
  return events[0] as MessageEvent;
}

describe("parseWebhook messages", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["text", { type: "text", text: { body: "hello" } }],
    ["image", { type: "image", image: { id: "M1", mime_type: "image/jpeg", sha256: "x", caption: "c" } }],
    ["video", { type: "video", video: { id: "M2", mime_type: "video/mp4" } }],
    ["audio", { type: "audio", audio: { id: "M3", mime_type: "audio/ogg; codecs=opus", voice: true } }],
    ["document", { type: "document", document: { id: "M4", mime_type: "application/pdf", filename: "a.pdf" } }],
    ["sticker", { type: "sticker", sticker: { id: "M5", mime_type: "image/webp", animated: false } }],
    ["location", { type: "location", location: { latitude: 1.5, longitude: 2.5, name: "N" } }],
    ["contacts", { type: "contacts", contacts: [{ name: { formatted_name: "A" } }] }],
    ["interactive", { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "b1", title: "Yes" } } }],
    ["button", { type: "button", button: { payload: "P", text: "Yes" } }],
    ["reaction", { type: "reaction", reaction: { message_id: "wamid.X", emoji: "👍" } }],
    ["order", { type: "order", order: { catalog_id: "C", product_items: [] } }],
    ["system", { type: "system", system: { body: "changed number", type: "user_changed_number" } }],
    ["unsupported", { type: "unsupported", errors: [{ code: 131051, title: "Message type is not supported" }] }],
  ];

  it.each(cases)("parses %s messages", (type, m) => {
    const ev = one(m);
    expect(ev.kind).toBe("message");
    expect(ev.message.type).toBe(type);
    expect(ev.message.id).toBe("wamid.IN");
    expect(ev.message.from).toBe("8801700000000");
  });

  it("attaches metadata and entry id", () => {
    const ev = one({ type: "text", text: { body: "x" } });
    expect(ev.metadata).toEqual(metadata);
    expect(ev.entryId).toBe("WABA1");
  });
  it("matches the sender's contact profile", () => {
    expect(one({ type: "text", text: { body: "x" } }).contact?.profile?.name).toBe("Rahim");
  });
  it("leaves contact undefined when none is sent", () => {
    const [ev] = parseWebhook(envelope({ messages: [msg({ type: "text", text: { body: "x" } })] })) as MessageEvent[];
    expect(ev!.contact).toBeUndefined();
  });
  it("preserves reply context", () => {
    const ev = one({ type: "text", text: { body: "x" }, context: { from: "15550001111", id: "wamid.OUT" } });
    expect(ev.message.context?.id).toBe("wamid.OUT");
  });
  it("passes unknown message types through for forward compatibility", () => {
    const ev = one({ type: "future_thing", future_thing: { a: 1 } });
    expect(ev.message.type).toBe("future_thing");
  });
  it("returns multiple messages in order", () => {
    const events = parseWebhook(
      envelope({ messages: [msg({ id: "a", type: "text", text: { body: "1" } }), msg({ id: "b", type: "text", text: { body: "2" } })] }),
    );
    expect(events.map((e) => (e as MessageEvent).message.id)).toEqual(["a", "b"]);
  });
  it("handles several entries and changes", () => {
    const one1 = envelope({ messages: [msg({ id: "a", type: "text", text: { body: "1" } })] });
    const one2 = envelope({ messages: [msg({ id: "b", type: "text", text: { body: "2" } })] });
    const combined = { object: one1.object, entry: [...one1.entry, ...one2.entry] };
    expect(parseWebhook(combined)).toHaveLength(2);
  });
});

describe("parseWebhook statuses", () => {
  const status = (s: string, extra: Record<string, unknown> = {}) => ({
    id: "wamid.OUT",
    status: s,
    timestamp: "1700000001",
    recipient_id: "8801700000000",
    ...extra,
  });

  it.each(["sent", "delivered", "read", "failed"])("parses %s status", (s) => {
    const [ev] = parseWebhook(envelope({ statuses: [status(s)] })) as StatusEvent[];
    expect(ev!.kind).toBe("status");
    expect(ev!.status.status).toBe(s);
    expect(ev!.status.recipient_id).toBe("8801700000000");
  });
  it("keeps conversation and pricing info", () => {
    const [ev] = parseWebhook(
      envelope({
        statuses: [
          status("sent", {
            conversation: { id: "C1", origin: { type: "service" }, expiration_timestamp: "1700086400" },
            pricing: { billable: true, pricing_model: "CBP", category: "service" },
          }),
        ],
      }),
    ) as StatusEvent[];
    expect(ev!.status.conversation?.origin?.type).toBe("service");
    expect(ev!.status.pricing?.category).toBe("service");
  });
  it("keeps error details on failed statuses", () => {
    const [ev] = parseWebhook(
      envelope({ statuses: [status("failed", { errors: [{ code: 131026, title: "Message undeliverable" }] })] }),
    ) as StatusEvent[];
    expect(ev!.status.errors?.[0]?.code).toBe(131026);
  });
  it("emits both messages and statuses from one change", () => {
    const events = parseWebhook(envelope({ messages: [msg({ type: "text", text: { body: "x" } })], statuses: [status("read")] }));
    expect(events.map((e) => e.kind)).toEqual(["message", "status"]);
  });
  it("emits value level errors", () => {
    const events = parseWebhook(envelope({ errors: [{ code: 131000, title: "Something went wrong" }] }));
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("error");
  });
});

describe("parseWebhook robustness", () => {
  it.each([null, undefined, 42, "str", true])("throws for non-object input %j", (input) => {
    expect(() => parseWebhook(input)).toThrow(WhatsAppError);
  });
  it("returns [] for other objects (e.g. instagram)", () => {
    expect(parseWebhook({ object: "instagram", entry: [] })).toEqual([]);
  });
  it("returns [] when entry is missing", () => {
    expect(parseWebhook({ object: "whatsapp_business_account" })).toEqual([]);
  });
  it("ignores unrelated change fields", () => {
    expect(parseWebhook(envelope({}, "message_template_status_update"))).toEqual([]);
  });
  it("ignores changes without a value", () => {
    expect(parseWebhook({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages" }] }] })).toEqual([]);
  });
  it("handles entries without changes", () => {
    expect(parseWebhook({ object: "whatsapp_business_account", entry: [{ id: "1" }] })).toEqual([]);
  });
  it("falls back to empty metadata", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ id: "1", changes: [{ field: "messages", value: { messages: [msg({ type: "text", text: { body: "x" } })] } }] }],
    };
    expect((parseWebhook(payload)[0] as MessageEvent).metadata.phone_number_id).toBe("");
  });
});

describe("getMessageText", () => {
  const t = (m: Record<string, unknown>) => getMessageText(msg(m) as IncomingMessage);

  it("reads text bodies", () => expect(t({ type: "text", text: { body: "hi" } })).toBe("hi"));
  it("reads template button text", () => expect(t({ type: "button", button: { payload: "p", text: "Yes" } })).toBe("Yes"));
  it("reads button_reply titles", () =>
    expect(t({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "1", title: "Go" } } })).toBe("Go"));
  it("reads list_reply titles", () =>
    expect(t({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "1", title: "Row" } } })).toBe("Row"));
  it("reads image captions", () => expect(t({ type: "image", image: { id: "1", mime_type: "x", caption: "cap" } })).toBe("cap"));
  it("reads document captions", () => expect(t({ type: "document", document: { id: "1", mime_type: "x", caption: "d" } })).toBe("d"));
  it("returns undefined for captionless media", () => expect(t({ type: "video", video: { id: "1", mime_type: "x" } })).toBeUndefined());
  it("returns undefined for locations", () => expect(t({ type: "location", location: { latitude: 0, longitude: 0 } })).toBeUndefined());
});
