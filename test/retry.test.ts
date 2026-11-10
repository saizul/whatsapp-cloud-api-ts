import { describe, expect, it } from "vitest";
import { DEFAULT_API_VERSION, WhatsAppApiError, WhatsAppNetworkError } from "../src/index.js";
import { jsonResponse, makeClient, mockFetch, OK_SEND } from "./helpers.js";

const TO = "8801700000000";
const err = (status: number, headers: Record<string, string> = {}) =>
  jsonResponse({ error: { message: "boom", code: 1 } }, status, headers);

describe("retries", () => {
  it.each([429, 500, 502, 503, 504])("retries HTTP %i then succeeds", async (status) => {
    const m = mockFetch(err(status), jsonResponse(OK_SEND));
    const { client, sleeps } = makeClient(m);
    await expect(client.sendText(TO, "hi")).resolves.toEqual(OK_SEND);
    expect(m.calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
  });
  it.each([400, 401, 403, 404, 413])("does not retry HTTP %i", async (status) => {
    const m = mockFetch(err(status));
    const { client, sleeps } = makeClient(m);
    await expect(client.sendText(TO, "hi")).rejects.toBeInstanceOf(WhatsAppApiError);
    expect(m.calls).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });
  it("gives up after maxRetries and throws the last error", async () => {
    const m = mockFetch(err(503));
    const { client, sleeps } = makeClient(m, { maxRetries: 2 });
    const e = (await client.sendText(TO, "hi").catch((x: unknown) => x)) as WhatsAppApiError;
    expect(e).toBeInstanceOf(WhatsAppApiError);
    expect(e.status).toBe(503);
    expect(m.calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });
  it("defaults to 3 retries (4 attempts)", async () => {
    const m = mockFetch(err(500));
    const { client } = makeClient(m);
    await client.sendText(TO, "hi").catch(() => undefined);
    expect(m.calls).toHaveLength(4);
  });
  it("maxRetries 0 disables retrying", async () => {
    const m = mockFetch(err(500));
    const { client } = makeClient(m, { maxRetries: 0 });
    await client.sendText(TO, "hi").catch(() => undefined);
    expect(m.calls).toHaveLength(1);
  });
  it("uses exponential backoff with equal jitter", async () => {
    const m = mockFetch(err(500));
    const { client, sleeps } = makeClient(m, { retryBaseDelayMs: 100, random: () => 0 });
    await client.sendText(TO, "hi").catch(() => undefined);
    // exp = 100, 200, 400 ; random 0 => half of each
    expect(sleeps).toEqual([50, 100, 200]);
  });
  it("jitter upper bound reaches the full exponential delay", async () => {
    const m = mockFetch(err(500));
    const { client, sleeps } = makeClient(m, { retryBaseDelayMs: 100, random: () => 0.999999 });
    await client.sendText(TO, "hi").catch(() => undefined);
    expect(sleeps).toEqual([100, 200, 400]);
  });
  it("caps backoff at retryMaxDelayMs", async () => {
    const m = mockFetch(err(500));
    const { client, sleeps } = makeClient(m, { retryBaseDelayMs: 1000, retryMaxDelayMs: 1500, random: () => 0 });
    await client.sendText(TO, "hi").catch(() => undefined);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(750);
  });
  it("honours Retry-After seconds", async () => {
    const m = mockFetch(err(429, { "retry-after": "2" }), jsonResponse(OK_SEND));
    const { client, sleeps } = makeClient(m);
    await client.sendText(TO, "hi");
    expect(sleeps).toEqual([2000]);
  });
  it("caps Retry-After at retryMaxDelayMs", async () => {
    const m = mockFetch(err(429, { "retry-after": "999" }), jsonResponse(OK_SEND));
    const { client, sleeps } = makeClient(m, { retryMaxDelayMs: 5000 });
    await client.sendText(TO, "hi");
    expect(sleeps).toEqual([5000]);
  });
  it("ignores a malformed Retry-After and falls back to backoff", async () => {
    const m = mockFetch(err(429, { "retry-after": "soon" }), jsonResponse(OK_SEND));
    const { client, sleeps } = makeClient(m, { retryBaseDelayMs: 100 });
    await client.sendText(TO, "hi");
    expect(sleeps).toEqual([75]);
  });
  it("retries network errors then succeeds", async () => {
    const m = mockFetch(new TypeError("fetch failed"), jsonResponse(OK_SEND));
    const { client } = makeClient(m);
    await expect(client.sendText(TO, "hi")).resolves.toEqual(OK_SEND);
    expect(m.calls).toHaveLength(2);
  });
  it("throws WhatsAppNetworkError with cause after exhausting retries", async () => {
    const cause = new TypeError("fetch failed");
    const m = mockFetch(cause);
    const { client } = makeClient(m, { maxRetries: 1 });
    const e = (await client.sendText(TO, "hi").catch((x: unknown) => x)) as WhatsAppNetworkError;
    expect(e).toBeInstanceOf(WhatsAppNetworkError);
    expect(e.cause).toBe(cause);
    expect(m.calls).toHaveLength(2);
  });
  it("network error messages omit the query string", async () => {
    const m = mockFetch(new TypeError("down"));
    const { client } = makeClient(m, { maxRetries: 0 });
    const e = (await client.getMedia("M1").catch((x: unknown) => x)) as Error;
    expect(e.message).not.toContain("phone_number_id");
    expect(e.message).toContain(`/${DEFAULT_API_VERSION}/M1`);
  });
  it("resends the same body on each attempt", async () => {
    const m = mockFetch(err(500), err(500), jsonResponse(OK_SEND));
    const { client } = makeClient(m);
    await client.sendText(TO, "same");
    expect(m.calls.map((c) => c.body.text.body)).toEqual(["same", "same", "same"]);
  });
  it("retries media downloads on 5xx", async () => {
    const m = mockFetch(err(503), new Response(new Uint8Array([1])));
    const { client } = makeClient(m);
    const out = await client.downloadMedia("https://lookaside.test/x");
    expect(out.data[0]).toBe(1);
  });
});
