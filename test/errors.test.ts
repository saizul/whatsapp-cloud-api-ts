import { describe, expect, it } from "vitest";
import {
  WhatsAppApiError,
  WhatsAppError,
  WhatsAppNetworkError,
  WhatsAppValidationError,
  extractGraphError,
} from "../src/index.js";
import { jsonResponse, makeClient, mockFetch } from "./helpers.js";

const graphError = {
  error: {
    message: "(#131030) Recipient phone number not in allowed list",
    type: "OAuthException",
    code: 131030,
    error_data: { messaging_product: "whatsapp", details: "Add the number to the allowed list" },
    error_subcode: 2494073,
    fbtrace_id: "AbCdEf",
  },
};

describe("WhatsAppApiError mapping", () => {
  it("maps every documented field", () => {
    const e = new WhatsAppApiError(400, graphError);
    expect(e.status).toBe(400);
    expect(e.code).toBe(131030);
    expect(e.subcode).toBe(2494073);
    expect(e.type).toBe("OAuthException");
    expect(e.fbtraceId).toBe("AbCdEf");
    expect(e.details).toBe("Add the number to the allowed list");
    expect(e.body).toBe(graphError);
  });
  it("includes the code in the message", () => {
    expect(new WhatsAppApiError(400, graphError).message).toContain("code 131030");
  });
  it("is an Error, WhatsAppError and has a proper name", () => {
    const e = new WhatsAppApiError(400, graphError);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(WhatsAppError);
    expect(e.name).toBe("WhatsAppApiError");
  });
  it("falls back to a generic message when the body is not a graph error", () => {
    const e = new WhatsAppApiError(502, "<html>Bad gateway</html>");
    expect(e.message).toBe("Request failed with HTTP 502");
    expect(e.code).toBeUndefined();
    expect(e.body).toBe("<html>Bad gateway</html>");
  });
  it("tolerates null and odd bodies", () => {
    expect(new WhatsAppApiError(500, null).code).toBeUndefined();
    expect(new WhatsAppApiError(500, { error: "string" }).code).toBeUndefined();
    expect(new WhatsAppApiError(500, undefined).message).toMatch(/500/);
  });
  it("flags auth errors on code 190", () => {
    expect(new WhatsAppApiError(400, { error: { code: 190, message: "expired" } }).isAuthError).toBe(true);
  });
  it("flags auth errors on HTTP 401", () => {
    expect(new WhatsAppApiError(401, {}).isAuthError).toBe(true);
  });
  it("does not flag unrelated errors as auth", () => {
    expect(new WhatsAppApiError(400, graphError).isAuthError).toBe(false);
  });
  it.each([4, 17, 80007, 130429, 131048])("treats code %i as rate limited", (code) => {
    const e = new WhatsAppApiError(400, { error: { code, message: "x" } });
    expect(e.isRateLimited).toBe(true);
    expect(e.isRetryable).toBe(true);
  });
  it("treats HTTP 429 as rate limited", () => {
    expect(new WhatsAppApiError(429, {}).isRateLimited).toBe(true);
  });
  it.each([500, 502, 503, 504])("treats HTTP %i as retryable", (s) => {
    expect(new WhatsAppApiError(s, {}).isRetryable).toBe(true);
  });
  it("treats 400 as non-retryable", () => {
    expect(new WhatsAppApiError(400, graphError).isRetryable).toBe(false);
  });
  it("extractGraphError returns undefined for non-objects", () => {
    expect(extractGraphError("x")).toBeUndefined();
    expect(extractGraphError(null)).toBeUndefined();
    expect(extractGraphError({})).toBeUndefined();
  });
  it("other error classes are distinct", () => {
    expect(new WhatsAppValidationError("v")).toBeInstanceOf(WhatsAppError);
    expect(new WhatsAppNetworkError("n").name).toBe("WhatsAppNetworkError");
  });
});

describe("client error surface", () => {
  it("throws WhatsAppApiError for a 400 Graph payload without retrying", async () => {
    const m = mockFetch(jsonResponse(graphError, 400));
    const { client, sleeps } = makeClient(m);
    const err = await client.sendText("8801700000000", "hi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatsAppApiError);
    expect((err as WhatsAppApiError).code).toBe(131030);
    expect(m.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
  it("handles non-JSON error bodies", async () => {
    const m = mockFetch(new Response("nope", { status: 403 }));
    const { client } = makeClient(m);
    const err = (await client.sendText("8801700000000", "hi").catch((e: unknown) => e)) as WhatsAppApiError;
    expect(err.status).toBe(403);
    expect(err.body).toBe("nope");
  });
  it("does not leak the token in error messages", async () => {
    const m = mockFetch(jsonResponse(graphError, 400));
    const { client } = makeClient(m);
    const err = (await client.sendText("8801700000000", "hi").catch((e: unknown) => e)) as Error;
    expect(String(err.message)).not.toContain("TOKEN");
  });
  it("throws when a 200 response is not JSON", async () => {
    const m = mockFetch(new Response("<html>", { status: 200 }));
    const { client } = makeClient(m);
    await expect(client.sendText("8801700000000", "hi")).rejects.toBeInstanceOf(WhatsAppApiError);
  });
  it("returns an empty object for an empty 200 body", async () => {
    const m = mockFetch(new Response("", { status: 200 }));
    const { client } = makeClient(m);
    await expect(client.markAsRead("wamid.1")).resolves.toEqual({});
  });
});
