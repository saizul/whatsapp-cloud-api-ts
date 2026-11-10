import { describe, expect, it } from "vitest";
import { DEFAULT_API_VERSION, MEDIA_LIMITS, WhatsAppApiError, WhatsAppValidationError, getMediaKind } from "../src/index.js";
import { jsonResponse, makeClient, mockFetch } from "./helpers.js";

describe("uploadMedia", () => {
  it("posts multipart form data without a manual content type", async () => {
    const m = mockFetch(jsonResponse({ id: "MEDIA123" }));
    const { client } = makeClient(m);
    const res = await client.uploadMedia(new Uint8Array([1, 2, 3]), "image/png", "a.png");
    expect(res.id).toBe("MEDIA123");
    expect(m.calls[0]!.url).toBe(`https://graph.facebook.com/${DEFAULT_API_VERSION}/1234567890/media`);
    const headers = m.calls[0]!.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(m.calls[0]!.init.body).toBeInstanceOf(FormData);
  });
  it("includes messaging_product, type and file fields", async () => {
    const m = mockFetch(jsonResponse({ id: "1" }));
    const { client } = makeClient(m);
    await client.uploadMedia(new Uint8Array([9]), "application/pdf", "x.pdf");
    const form = m.calls[0]!.init.body as FormData;
    expect(form.get("messaging_product")).toBe("whatsapp");
    expect(form.get("type")).toBe("application/pdf");
    const file = form.get("file") as File;
    expect(file.name).toBe("x.pdf");
    expect(file.type).toBe("application/pdf");
    expect(file.size).toBe(1);
  });
  it("accepts a Blob and an ArrayBuffer", async () => {
    const m = mockFetch(jsonResponse({ id: "1" }));
    const { client } = makeClient(m);
    await client.uploadMedia(new Blob(["abc"], { type: "audio/ogg" }), "audio/ogg");
    await client.uploadMedia(new ArrayBuffer(4), "audio/ogg");
    expect(m.calls).toHaveLength(2);
  });
  it("rewrites the blob type to the declared mime type", async () => {
    const m = mockFetch(jsonResponse({ id: "1" }));
    const { client } = makeClient(m);
    await client.uploadMedia(new Blob(["abc"], { type: "text/plain" }), "image/jpeg");
    expect(((m.calls[0]!.init.body as FormData).get("file") as File).type).toBe("image/jpeg");
  });
  it("requires a mime type", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.uploadMedia(new Uint8Array(), "")).toThrow(WhatsAppValidationError);
  });
});

describe("getMedia / downloadMedia / deleteMedia", () => {
  const info = { id: "M1", url: "https://lookaside.test/dl?x=1", mime_type: "image/jpeg", sha256: "abc", file_size: 3 };

  it("getMedia requests /{id}?phone_number_id=", async () => {
    const m = mockFetch(jsonResponse(info));
    const { client } = makeClient(m);
    const res = await client.getMedia("M1");
    expect(res).toEqual(info);
    expect(m.calls[0]!.url).toBe(`https://graph.facebook.com/${DEFAULT_API_VERSION}/M1?phone_number_id=1234567890`);
    expect(m.calls[0]!.init.method).toBe("GET");
    expect(m.calls[0]!.init.body).toBeUndefined();
  });
  it("downloadMedia resolves an id then fetches the url with the token", async () => {
    const m = mockFetch(
      jsonResponse(info),
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }),
    );
    const { client } = makeClient(m);
    const out = await client.downloadMedia("M1");
    expect(Array.from(out.data)).toEqual([1, 2, 3]);
    expect(out.contentType).toBe("image/jpeg");
    expect(m.calls[1]!.url).toBe(info.url);
    expect((m.calls[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
  });
  it("downloadMedia accepts a url directly (no lookup)", async () => {
    const m = mockFetch(new Response(new Uint8Array([7]), { headers: { "content-type": "audio/ogg" } }));
    const { client } = makeClient(m);
    const out = await client.downloadMedia("https://lookaside.test/file");
    expect(m.calls).toHaveLength(1);
    expect(out.data[0]).toBe(7);
  });
  it("downloadMedia surfaces API errors", async () => {
    const m = mockFetch(jsonResponse({ error: { message: "Media not found", code: 100 } }, 404));
    const { client } = makeClient(m);
    await expect(client.downloadMedia("https://lookaside.test/gone")).rejects.toBeInstanceOf(WhatsAppApiError);
  });
  it("downloadMedia requires input", async () => {
    const { client } = makeClient(mockFetch());
    await expect(client.downloadMedia("")).rejects.toBeInstanceOf(WhatsAppValidationError);
  });
  it("getMedia requires an id", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.getMedia("")).toThrow(WhatsAppValidationError);
  });
  it("deleteMedia sends DELETE", async () => {
    const m = mockFetch(jsonResponse({ success: true }));
    const { client } = makeClient(m);
    await client.deleteMedia("M1");
    expect(m.calls[0]!.init.method).toBe("DELETE");
    expect(m.calls[0]!.url).toBe(`https://graph.facebook.com/${DEFAULT_API_VERSION}/M1`);
  });
  it("deleteMedia requires an id", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.deleteMedia("")).toThrow(WhatsAppValidationError);
  });
});

describe("upload validation", () => {
  it("rejects unsupported MIME types before any request", () => {
    const m = mockFetch(jsonResponse({ id: "1" }));
    const { client } = makeClient(m);
    expect(() => client.uploadMedia(new Uint8Array([1]), "image/gif")).toThrow(WhatsAppValidationError);
    expect(() => client.uploadMedia(new Uint8Array([1]), "application/zip")).toThrow(/unsupported media type/);
    expect(m.calls).toHaveLength(0);
  });
  it("rejects empty files", () => {
    const m = mockFetch(jsonResponse({ id: "1" }));
    const { client } = makeClient(m);
    expect(() => client.uploadMedia(new Uint8Array(0), "image/png")).toThrow(/empty/);
    expect(m.calls).toHaveLength(0);
  });
  it("enforces the per-kind size limit", async () => {
    const m = mockFetch(jsonResponse({ id: "1" }));
    const { client } = makeClient(m);
    const overImage = new Uint8Array(MEDIA_LIMITS.image.maxBytes + 1);
    expect(() => client.uploadMedia(overImage, "image/jpeg")).toThrow(/image files must be at most/);
    expect(() => client.uploadMedia(new Uint8Array(MEDIA_LIMITS.sticker.maxBytes + 1), "image/webp")).toThrow(
      /sticker/,
    );
    expect(m.calls).toHaveLength(0);
    // The same size is fine for a document, whose limit is much higher.
    await client.uploadMedia(overImage, "application/pdf");
    expect(m.calls).toHaveLength(1);
  });
  it("accepts a size exactly at the limit and MIME parameters", async () => {
    const m = mockFetch(jsonResponse({ id: "1" }), jsonResponse({ id: "2" }));
    const { client } = makeClient(m);
    await client.uploadMedia(new Uint8Array(MEDIA_LIMITS.image.maxBytes), "image/png");
    await client.uploadMedia(new Uint8Array([1]), "audio/ogg; codecs=opus");
    expect(m.calls).toHaveLength(2);
  });
  it("measures Blob and ArrayBuffer inputs", () => {
    const { client } = makeClient(mockFetch());
    expect(() => client.uploadMedia(new ArrayBuffer(0), "video/mp4")).toThrow(/empty/);
    expect(() =>
      client.uploadMedia(new Blob([new Uint8Array(MEDIA_LIMITS.image.maxBytes + 1)]), "image/png"),
    ).toThrow(/at most/);
  });
  it("can be disabled with validate: false", async () => {
    const m = mockFetch(jsonResponse({ id: "1" }));
    const { client } = makeClient(m, { validate: false });
    await client.uploadMedia(new Uint8Array([1]), "image/gif");
    expect(m.calls).toHaveLength(1);
  });
});

describe("getMediaKind", () => {
  it("maps MIME types to media kinds", () => {
    expect(getMediaKind("image/png")).toBe("image");
    expect(getMediaKind("VIDEO/MP4")).toBe("video");
    expect(getMediaKind("audio/ogg; codecs=opus")).toBe("audio");
    expect(getMediaKind("application/pdf")).toBe("document");
    expect(getMediaKind("image/webp")).toBe("sticker");
    expect(getMediaKind("image/gif")).toBeUndefined();
    expect(getMediaKind("")).toBeUndefined();
  });
});
