import { describe, expect, it } from "vitest";
import { WhatsAppClient, WhatsAppValidationError } from "../src/index.js";
import { jsonResponse, makeClient, mockFetch, OK_SEND } from "./helpers.js";

const TO = "8801700000000";

describe("client construction", () => {
  it("requires accessToken", () => {
    expect(() => new WhatsAppClient({ accessToken: "", phoneNumberId: "1" })).toThrow(WhatsAppValidationError);
  });
  it("requires phoneNumberId", () => {
    expect(() => new WhatsAppClient({ accessToken: "x", phoneNumberId: "" })).toThrow(/phoneNumberId/);
  });
  it.each(["21.0", "v21", "latest", "v21.0.1"])("rejects apiVersion %j", (v) => {
    expect(() => new WhatsAppClient({ accessToken: "x", phoneNumberId: "1", apiVersion: v })).toThrow(/apiVersion/);
  });
  it.each(["v19.0", "v21.0", "v22.0"])("accepts apiVersion %s", (v) => {
    const c = new WhatsAppClient({ accessToken: "x", phoneNumberId: "1", apiVersion: v });
    expect(c.apiVersion).toBe(v);
  });
  it("defaults to v21.0 and graph.facebook.com", () => {
    const c = new WhatsAppClient({ accessToken: "x", phoneNumberId: "1" });
    expect(c.apiVersion).toBe("v21.0");
    expect(c.baseUrl).toBe("https://graph.facebook.com");
  });
  it("strips trailing slashes from baseUrl", () => {
    const c = new WhatsAppClient({ accessToken: "x", phoneNumberId: "1", baseUrl: "http://localhost:9/// " .trim() });
    expect(c.baseUrl).toBe("http://localhost:9");
  });
  it("does not expose the token", () => {
    const c = new WhatsAppClient({ accessToken: "SECRET-TOKEN", phoneNumberId: "1" });
    expect(JSON.stringify(c)).not.toContain("SECRET-TOKEN");
    expect(Object.values(c)).not.toContain("SECRET-TOKEN");
  });
});

describe("request plumbing", () => {
  it("posts to /{version}/{phoneNumberId}/messages on the injected base URL", async () => {
    const m = mockFetch();
    const { client } = makeClient(m, { baseUrl: "http://mock.test", apiVersion: "v22.0" });
    await client.sendText(TO, "hi");
    expect(m.calls[0]!.url).toBe("http://mock.test/v22.0/1234567890/messages");
    expect(m.calls[0]!.init.method).toBe("POST");
  });
  it("sends bearer auth and JSON content type", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendText(TO, "hi");
    const h = m.calls[0]!.init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer TOKEN");
    expect(h["Content-Type"]).toBe("application/json");
  });
  it("returns the parsed response", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await expect(client.sendText(TO, "hi")).resolves.toEqual(OK_SEND);
  });
  it("strips a leading + and whitespace from the recipient", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendText(" +8801700000000 ", "hi");
    expect(m.calls[0]!.body.to).toBe(TO);
  });
  it("always sets messaging_product and recipient_type", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendText(TO, "hi");
    expect(m.calls[0]!.body).toMatchObject({ messaging_product: "whatsapp", recipient_type: "individual" });
  });
  it("uses the global fetch by default", async () => {
    const original = globalThis.fetch;
    let seen = "";
    globalThis.fetch = (async (u: string) => {
      seen = String(u);
      return jsonResponse(OK_SEND);
    }) as unknown as typeof fetch;
    try {
      const c = new WhatsAppClient({ accessToken: "x", phoneNumberId: "9" });
      await c.sendText(TO, "hi");
      expect(seen).toBe("https://graph.facebook.com/v21.0/9/messages");
    } finally {
      globalThis.fetch = original;
    }
  });
  it("attaches a timeout signal", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendText(TO, "hi");
    expect(m.calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });
  it("omits the signal when timeoutMs is 0", async () => {
    const m = mockFetch();
    const { client } = makeClient(m, { timeoutMs: 0 });
    await client.sendText(TO, "hi");
    expect(m.calls[0]!.init.signal).toBeUndefined();
  });
});

describe("sendText", () => {
  it("builds a text message", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendText(TO, "Hello");
    expect(m.calls[0]!.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: TO,
      type: "text",
      text: { body: "Hello" },
    });
  });
  it("sets preview_url when asked", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendText(TO, "https://saizul.com", { previewUrl: true });
    expect(m.calls[0]!.body.text.preview_url).toBe(true);
  });
  it("sets reply context", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendText(TO, "re", { replyTo: "wamid.X" });
    expect(m.calls[0]!.body.context).toEqual({ message_id: "wamid.X" });
  });
  it("supports Bangla and emoji bodies", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendText(TO, "আসসালামু আলাইকুম 👋");
    expect(m.calls[0]!.body.text.body).toBe("আসসালামু আলাইকুম 👋");
  });
  it("rejects empty text", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendText(TO, "  ")).toThrow(WhatsAppValidationError);
  });
  it("rejects text over 4096 characters", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendText(TO, "a".repeat(4097))).toThrow(/4096/);
  });
  it("accepts exactly 4096 characters", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendText(TO, "a".repeat(4096));
    expect(m.calls).toHaveLength(1);
  });
  it.each(["", "abc", "12", "88017-000", "+", "1".repeat(21)])("rejects recipient %j", (to) => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendText(to, "hi")).toThrow(/international format/);
  });
  it("can disable validation", async () => {
    const m = mockFetch();
    const { client } = makeClient(m, { validate: false });
    await client.sendText("weird", "x".repeat(5000));
    expect(m.calls).toHaveLength(1);
  });
});

describe("sendTemplate", () => {
  it("sends name and language code", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendTemplate(TO, { name: "hello_world", language: "en_US" });
    expect(m.calls[0]!.body.type).toBe("template");
    expect(m.calls[0]!.body.template).toEqual({ name: "hello_world", language: { code: "en_US" } });
  });
  it("includes body parameters", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendTemplate(TO, {
      name: "order_update",
      language: "bn",
      components: [{ type: "body", parameters: [{ type: "text", text: "Saizul" }, { type: "text", text: "#42" }] }],
    });
    expect(m.calls[0]!.body.template.components[0].parameters).toHaveLength(2);
  });
  it("supports header media parameters", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendTemplate(TO, {
      name: "promo",
      language: "en",
      components: [{ type: "header", parameters: [{ type: "image", image: { link: "https://x.test/a.jpg" } }] }],
    });
    expect(m.calls[0]!.body.template.components[0].parameters[0].image.link).toBe("https://x.test/a.jpg");
  });
  it("stringifies numeric button index", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendTemplate(TO, {
      name: "t",
      language: "en",
      components: [{ type: "button", sub_type: "quick_reply", index: 0, parameters: [{ type: "payload", payload: "YES" }] }],
    });
    expect(m.calls[0]!.body.template.components[0].index).toBe("0");
  });
  it("supports currency and date_time parameters", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendTemplate(TO, {
      name: "invoice",
      language: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "currency", currency: { fallback_value: "BDT 500", code: "BDT", amount_1000: 500000 } },
            { type: "date_time", date_time: { fallback_value: "1 Jan 2026" } },
          ],
        },
      ],
    });
    const p = m.calls[0]!.body.template.components[0].parameters;
    expect(p[0].currency.code).toBe("BDT");
    expect(p[1].date_time.fallback_value).toBe("1 Jan 2026");
  });
  it("omits components when the list is empty", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendTemplate(TO, { name: "t", language: "en", components: [] });
    expect(m.calls[0]!.body.template).not.toHaveProperty("components");
  });
  it("requires name", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendTemplate(TO, { name: "", language: "en" })).toThrow(/name/);
  });
  it("requires language", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendTemplate(TO, { name: "x", language: "" })).toThrow(/language/);
  });
});

describe("media messages", () => {
  const kinds = [
    ["sendImage", "image"],
    ["sendVideo", "video"],
    ["sendAudio", "audio"],
    ["sendSticker", "sticker"],
    ["sendDocument", "document"],
  ] as const;

  it.each(kinds)("%s by link", async (method, type) => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client[method](TO, { link: "https://cdn.test/file" });
    expect(m.calls[0]!.body.type).toBe(type);
    expect(m.calls[0]!.body[type]).toEqual({ link: "https://cdn.test/file" });
  });
  it.each(kinds)("%s by media id", async (method, type) => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client[method](TO, { id: "MEDIA1" });
    expect(m.calls[0]!.body[type]).toEqual({ id: "MEDIA1" });
  });
  it.each(kinds)("%s rejects http links", (method) => {
    const { client } = makeClient(mockFetch());
    expect(() => client[method](TO, { link: "http://insecure.test/a" })).toThrow(/https/);
  });
  it.each(kinds)("%s rejects empty media ref", (method) => {
    const { client } = makeClient(mockFetch());
    expect(() => client[method](TO, {} as never)).toThrow(/exactly one/);
  });
  it.each(kinds)("%s rejects id and link together", (method) => {
    const { client } = makeClient(mockFetch());
    expect(() => client[method](TO, { id: "1", link: "https://a.test/x" } as never)).toThrow(/exactly one/);
  });
  it("image caption", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendImage(TO, { id: "1" }, { caption: "Look" });
    expect(m.calls[0]!.body.image.caption).toBe("Look");
  });
  it("video caption", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendVideo(TO, { id: "1" }, { caption: "Clip" });
    expect(m.calls[0]!.body.video.caption).toBe("Clip");
  });
  it("document filename and caption", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendDocument(TO, { link: "https://a.test/i.pdf" }, { filename: "invoice.pdf", caption: "Invoice" });
    expect(m.calls[0]!.body.document).toEqual({ link: "https://a.test/i.pdf", filename: "invoice.pdf", caption: "Invoice" });
  });
  it("audio never carries a caption", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendAudio(TO, { id: "1" });
    expect(m.calls[0]!.body.audio).not.toHaveProperty("caption");
  });
  it("rejects captions over 1024 characters", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendImage(TO, { id: "1" }, { caption: "x".repeat(1025) })).toThrow(/1024/);
  });
  it("supports reply context on media", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendImage(TO, { id: "1" }, { replyTo: "wamid.A" });
    expect(m.calls[0]!.body.context.message_id).toBe("wamid.A");
  });
});

describe("interactive buttons", () => {
  const base = { body: "Pick one", buttons: [{ id: "a", title: "Alpha" }, { id: "b", title: "Beta" }] };

  it("builds a button message", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendButtons(TO, base);
    expect(m.calls[0]!.body.interactive).toEqual({
      type: "button",
      body: { text: "Pick one" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "a", title: "Alpha" } },
          { type: "reply", reply: { id: "b", title: "Beta" } },
        ],
      },
    });
  });
  it("adds header and footer", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendButtons(TO, { ...base, header: "H", footer: "F" });
    expect(m.calls[0]!.body.interactive.header).toEqual({ type: "text", text: "H" });
    expect(m.calls[0]!.body.interactive.footer).toEqual({ text: "F" });
  });
  it("rejects zero buttons", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendButtons(TO, { ...base, buttons: [] })).toThrow(/1 to 3/);
  });
  it("rejects four buttons", () => {
    const { client } = makeClient(mockFetch());
    const buttons = ["a", "b", "c", "d"].map((x) => ({ id: x, title: x }));
    expect(() => client.sendButtons(TO, { ...base, buttons })).toThrow(/1 to 3/);
  });
  it("rejects titles over 20 characters", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendButtons(TO, { ...base, buttons: [{ id: "a", title: "x".repeat(21) }] })).toThrow(/20/);
  });
  it("accepts a 20 character title", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendButtons(TO, { ...base, buttons: [{ id: "a", title: "x".repeat(20) }] });
    expect(m.calls).toHaveLength(1);
  });
  it("rejects duplicate ids", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendButtons(TO, { ...base, buttons: [{ id: "a", title: "A" }, { id: "a", title: "B" }] })).toThrow(/duplicate/);
  });
  it("rejects empty body", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendButtons(TO, { ...base, body: "" })).toThrow(/body/);
  });
  it("rejects long header", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendButtons(TO, { ...base, header: "h".repeat(61) })).toThrow(/60/);
  });
  it("rejects empty button id", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendButtons(TO, { ...base, buttons: [{ id: "", title: "A" }] })).toThrow(/id/);
  });
});

describe("interactive list", () => {
  const base = {
    body: "Menu",
    buttonText: "Open",
    sections: [{ title: "Main", rows: [{ id: "1", title: "One", description: "first" }, { id: "2", title: "Two" }] }],
  };

  it("builds a list message", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendList(TO, base);
    expect(m.calls[0]!.body.interactive).toEqual({
      type: "list",
      body: { text: "Menu" },
      action: {
        button: "Open",
        sections: [{ title: "Main", rows: [{ id: "1", title: "One", description: "first" }, { id: "2", title: "Two" }] }],
      },
    });
  });
  it("allows a single untitled section", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendList(TO, { ...base, sections: [{ rows: [{ id: "1", title: "One" }] }] });
    expect(m.calls[0]!.body.interactive.action.sections[0]).not.toHaveProperty("title");
  });
  it("requires titles when several sections exist", () => {
    const { client } = makeClient(mockFetch());
    const sections = [{ rows: [{ id: "1", title: "A" }] }, { title: "B", rows: [{ id: "2", title: "B" }] }];
    expect(() => client.sendList(TO, { ...base, sections })).toThrow(/section title/);
  });
  it("accepts exactly 10 rows across sections", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    const rows = (s: number) => Array.from({ length: 5 }, (_, i) => ({ id: `${s}-${i}`, title: `R${i}` }));
    await client.sendList(TO, { ...base, sections: [{ title: "A", rows: rows(1) }, { title: "B", rows: rows(2) }] });
    expect(m.calls).toHaveLength(1);
  });
  it("rejects 11 rows", () => {
    const { client } = makeClient(mockFetch());
    const rows = Array.from({ length: 11 }, (_, i) => ({ id: String(i), title: `R${i}` }));
    expect(() => client.sendList(TO, { ...base, sections: [{ rows }] })).toThrow(/10 rows/);
  });
  it("rejects zero rows", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendList(TO, { ...base, sections: [{ rows: [] }] })).toThrow(/rows/);
  });
  it("rejects long button text", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendList(TO, { ...base, buttonText: "x".repeat(21) })).toThrow(/20/);
  });
  it("rejects long row title", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendList(TO, { ...base, sections: [{ rows: [{ id: "1", title: "x".repeat(25) }] }] })).toThrow(/24/);
  });
  it("rejects long row description", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendList(TO, { ...base, sections: [{ rows: [{ id: "1", title: "a", description: "d".repeat(73) }] }] })).toThrow(/72/);
  });
  it("rejects duplicate row ids", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendList(TO, { ...base, sections: [{ rows: [{ id: "1", title: "a" }, { id: "1", title: "b" }] }] })).toThrow(/duplicate/);
  });
  it("rejects no sections", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendList(TO, { ...base, sections: [] })).toThrow(/sections/);
  });
});

describe("reaction, location, contacts, read", () => {
  it("sends a reaction", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendReaction(TO, "wamid.A", "👍");
    expect(m.calls[0]!.body).toMatchObject({ type: "reaction", reaction: { message_id: "wamid.A", emoji: "👍" } });
  });
  it("allows an empty emoji to remove a reaction", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendReaction(TO, "wamid.A", "");
    expect(m.calls[0]!.body.reaction.emoji).toBe("");
  });
  it("requires a message id for reactions", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendReaction(TO, "", "👍")).toThrow(/messageId/);
  });
  it("sends a location", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendLocation(TO, { latitude: 23.8103, longitude: 90.4125, name: "Dhaka", address: "Bangladesh" });
    expect(m.calls[0]!.body.location).toEqual({ latitude: 23.8103, longitude: 90.4125, name: "Dhaka", address: "Bangladesh" });
  });
  it.each([
    [91, 0],
    [-91, 0],
    [0, 181],
    [0, -181],
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
  ])("rejects location %s,%s", (lat, lng) => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendLocation(TO, { latitude: lat, longitude: lng })).toThrow(/latitude|longitude/);
  });
  it.each([
    [90, 180],
    [-90, -180],
    [0, 0],
  ])("accepts boundary location %s,%s", async (lat, lng) => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendLocation(TO, { latitude: lat, longitude: lng });
    expect(m.calls).toHaveLength(1);
  });
  it("sends contacts", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendContacts(TO, [
      { name: { formatted_name: "Saizul Amin", first_name: "Saizul" }, phones: [{ phone: "+8801700000000", type: "CELL" }] },
    ]);
    expect(m.calls[0]!.body.contacts[0].name.formatted_name).toBe("Saizul Amin");
  });
  it("rejects an empty contacts list", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendContacts(TO, [])).toThrow(/at least one/);
  });
  it("rejects contacts without formatted_name", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.sendContacts(TO, [{ name: { formatted_name: "" } }])).toThrow(/formatted_name/);
  });
  it("marks a message as read", async () => {
    const m = mockFetch(jsonResponse({ success: true }));
    const { client } = makeClient(m);
    const res = await client.markAsRead("wamid.IN");
    expect(res.success).toBe(true);
    expect(m.calls[0]!.url).toMatch(/\/1234567890\/messages$/);
    expect(m.calls[0]!.body).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.IN" });
  });
  it("markAsRead requires an id", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.markAsRead("")).toThrow(WhatsAppValidationError);
  });
  it("sendRaw merges messaging_product", async () => {
    const m = mockFetch();
    const { client } = makeClient(m);
    await client.sendRaw({ to: TO, type: "text", text: { body: "x" } });
    expect(m.calls[0]!.body).toEqual({ messaging_product: "whatsapp", to: TO, type: "text", text: { body: "x" } });
  });
});
