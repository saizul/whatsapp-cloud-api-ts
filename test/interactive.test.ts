import { describe, expect, it } from "vitest";
import { LIMITS, WhatsAppValidationError } from "../src/index.js";
import type { InteractiveHeader } from "../src/index.js";
import { jsonResponse, makeClient, mockFetch } from "./helpers.js";

const TO = "8801700000000";

describe("interactive media headers on reply buttons", () => {
  const base = { body: "Pick one", buttons: [{ id: "a", title: "Alpha" }] };

  it("keeps the string shorthand as a text header", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendButtons(TO, { ...base, header: "Hello" });
    expect(m.calls[0]!.body.interactive.header).toEqual({ type: "text", text: "Hello" });
  });
  it("accepts an explicit text header object", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendButtons(TO, { ...base, header: { type: "text", text: "Hi" } });
    expect(m.calls[0]!.body.interactive.header).toEqual({ type: "text", text: "Hi" });
  });
  it("sends an image header by link", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendButtons(TO, { ...base, header: { type: "image", image: { link: "https://example.com/a.jpg" } } });
    expect(m.calls[0]!.body.interactive.header).toEqual({
      type: "image",
      image: { link: "https://example.com/a.jpg" },
    });
  });
  it("sends a video header by id", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendButtons(TO, { ...base, header: { type: "video", video: { id: "MEDIA_ID" } } });
    expect(m.calls[0]!.body.interactive.header).toEqual({ type: "video", video: { id: "MEDIA_ID" } });
  });
  it("sends a document header with filename", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendButtons(TO, {
      ...base,
      header: { type: "document", document: { id: "DOC_ID", filename: "invoice.pdf" } },
    });
    expect(m.calls[0]!.body.interactive.header).toEqual({
      type: "document",
      document: { id: "DOC_ID", filename: "invoice.pdf" },
    });
  });
  it("omits an empty string header as before", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendButtons(TO, { ...base, header: "" });
    expect(m.calls[0]!.body.interactive).not.toHaveProperty("header");
  });
  it("rejects a media header with both id and link", () => {
    const { client } = makeClient(mockFetch());
    const header = { type: "image", image: { id: "x", link: "https://example.com/a.jpg" } } as unknown as InteractiveHeader;
    expect(() => client.sendButtons(TO, { ...base, header })).toThrow(/exactly one/);
  });
  it("rejects a media header with a non-https link", () => {
    const { client } = makeClient(mockFetch());
    expect(() =>
      client.sendButtons(TO, { ...base, header: { type: "image", image: { link: "http://example.com/a.jpg" } } }),
    ).toThrow(/https/);
  });
  it("rejects a media header missing its media reference", () => {
    const { client } = makeClient(mockFetch());
    const header = { type: "video" } as unknown as InteractiveHeader;
    expect(() => client.sendButtons(TO, { ...base, header })).toThrow(/media reference/);
  });
  it("rejects an unknown header type", () => {
    const { client } = makeClient(mockFetch());
    const header = { type: "audio", audio: { id: "x" } } as unknown as InteractiveHeader;
    expect(() => client.sendButtons(TO, { ...base, header })).toThrow(/header type/);
  });
  it("rejects a text header object over 60 characters", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendButtons(TO, { ...base, header: { type: "text", text: "h".repeat(61) } })).toThrow(/60/);
  });
  it("rejects an empty text header object", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendButtons(TO, { ...base, header: { type: "text", text: "" } })).toThrow(/header text/);
  });
  it("sends media headers untouched when validation is off", async () => {
    const m = mockFetch();
    const { client } = makeClient(m, { validate: false });
    await client.sendButtons(TO, { ...base, header: { type: "image", image: { link: "http://insecure.test/a.jpg" } } });
    expect(m.calls[0]!.body.interactive.header.image.link).toBe("http://insecure.test/a.jpg");
  });
});

describe("list headers stay text only", () => {
  const base = { body: "Menu", buttonText: "Open", sections: [{ rows: [{ id: "r", title: "Row" }] }] };

  it("rejects a media header on a list", () => {
    const { client } = makeClient(mockFetch());
    const header = { type: "image", image: { id: "x" } } as unknown as string;
    expect(() => client.sendList(TO, { ...base, header })).toThrow(/only supports text headers/);
  });
  it("still sends a text header on a list", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendList(TO, { ...base, header: "Plans" });
    expect(m.calls[0]!.body.interactive.header).toEqual({ type: "text", text: "Plans" });
  });
});

describe("sendCtaUrl", () => {
  const base = { body: "See today's deals", displayText: "Open shop", url: "https://example.com/shop?ref=wa" };

  it("builds a cta_url interactive message", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendCtaUrl(TO, base);
    expect(m.calls[0]!.url).toMatch(/\/1234567890\/messages$/);
    expect(m.calls[0]!.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: TO,
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: "See today's deals" },
        action: {
          name: "cta_url",
          parameters: { display_text: "Open shop", url: "https://example.com/shop?ref=wa" },
        },
      },
    });
  });
  it("adds text header, footer and reply context", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendCtaUrl(TO, { ...base, header: "Deals", footer: "Ends tonight" }, { replyTo: "wamid.PREV" });
    const body = m.calls[0]!.body;
    expect(body.interactive.header).toEqual({ type: "text", text: "Deals" });
    expect(body.interactive.footer).toEqual({ text: "Ends tonight" });
    expect(body.context).toEqual({ message_id: "wamid.PREV" });
  });
  it("supports an image header", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendCtaUrl(TO, { ...base, header: { type: "image", image: { id: "IMG" } } });
    expect(m.calls[0]!.body.interactive.header).toEqual({ type: "image", image: { id: "IMG" } });
  });
  it("accepts a display text of exactly 20 characters", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendCtaUrl(TO, { ...base, displayText: "x".repeat(LIMITS.ctaDisplayText) });
    expect(m.calls).toHaveLength(1);
  });
  it("rejects a display text over 20 characters", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendCtaUrl(TO, { ...base, displayText: "x".repeat(21) })).toThrow(/displayText.*20/);
  });
  it("rejects an empty display text", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendCtaUrl(TO, { ...base, displayText: " " })).toThrow(/displayText/);
  });
  it.each(["", "example.com", "/relative", "ftp://example.com/file", "javascript:alert(1)"])(
    "rejects url %j",
    (url) => {
      const { client } = makeClient(mockFetch());
      expect(() => client.sendCtaUrl(TO, { ...base, url })).toThrow(WhatsAppValidationError);
    },
  );
  it("rejects an empty body", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendCtaUrl(TO, { ...base, body: "" })).toThrow(/body/);
  });
  it("rejects a body over 1024 characters", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendCtaUrl(TO, { ...base, body: "b".repeat(1025) })).toThrow(/1024/);
  });
  it("rejects a footer over 60 characters", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendCtaUrl(TO, { ...base, footer: "f".repeat(61) })).toThrow(/60/);
  });
  it("validates the recipient", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendCtaUrl("not-a-number", base)).toThrow(/`to`/);
  });
  it("does not call fetch when validation fails", () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    expect(() => client.sendCtaUrl(TO, { ...base, url: "nope" })).toThrow();
    expect(m.fn).not.toHaveBeenCalled();
  });
});

describe("sendLocationRequest", () => {
  it("builds a location_request_message", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendLocationRequest(TO, { body: "Where should we deliver?" });
    expect(m.calls[0]!.body.type).toBe("interactive");
    expect(m.calls[0]!.body.interactive).toEqual({
      type: "location_request_message",
      body: { text: "Where should we deliver?" },
      action: { name: "send_location" },
    });
  });
  it("supports reply context", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendLocationRequest(TO, { body: "Share location" }, { replyTo: "wamid.Q" });
    expect(m.calls[0]!.body.context).toEqual({ message_id: "wamid.Q" });
  });
  it("rejects an empty body", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendLocationRequest(TO, { body: "" })).toThrow(/body/);
  });
  it("rejects a body over 1024 characters", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendLocationRequest(TO, { body: "b".repeat(1025) })).toThrow(/1024/);
  });
});

describe("typing indicator", () => {
  it("markAsRead without options is unchanged", async () => {
    const m = mockFetch(jsonResponse({ success: true }));
    const { client } = makeClient(m);
    await client.markAsRead("wamid.IN");
    expect(m.calls[0]!.body).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.IN" });
  });
  it("markAsRead can add a typing indicator", async () => {
    const m = mockFetch(jsonResponse({ success: true }));
    const { client } = makeClient(m);
    const res = await client.markAsRead("wamid.IN", { typingIndicator: true });
    expect(res.success).toBe(true);
    expect(m.calls[0]!.body).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.IN",
      typing_indicator: { type: "text" },
    });
  });
  it("typingIndicator: false sends a plain read receipt", async () => {
    const m = mockFetch(jsonResponse({ success: true }));
    const { client } = makeClient(m);
    await client.markAsRead("wamid.IN", { typingIndicator: false });
    expect(m.calls[0]!.body).not.toHaveProperty("typing_indicator");
  });
  it("sendTypingIndicator posts the read + typing payload", async () => {
    const m = mockFetch(jsonResponse({ success: true }));
    const { client } = makeClient(m);
    await client.sendTypingIndicator("wamid.IN");
    expect(m.calls[0]!.url).toMatch(/\/1234567890\/messages$/);
    expect(m.calls[0]!.body.typing_indicator).toEqual({ type: "text" });
    expect(m.calls[0]!.body.status).toBe("read");
  });
  it.each(["", "   "])("sendTypingIndicator rejects message id %j", (id) => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendTypingIndicator(id)).toThrow(/messageId/);
  });
  it("is retried like any other request on 429", async () => {
    const m = mockFetch(jsonResponse({ error: { message: "slow down", code: 130429 } }, 429), jsonResponse({ success: true }));
    const { client, sleeps } = makeClient(m);
    await expect(client.sendTypingIndicator("wamid.IN")).resolves.toEqual({ success: true });
    expect(m.calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
  });
});
