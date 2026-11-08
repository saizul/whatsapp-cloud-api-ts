import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyAndParse, verifyChallenge, verifySignature, signPayload, WhatsAppError } from "../src/index.js";

describe("verifyChallenge", () => {
  const q = (o: Record<string, string>) => new URLSearchParams(o);

  it("echoes the challenge on a valid request", () => {
    const r = verifyChallenge(q({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "1158201444" }), "tok");
    expect(r).toEqual({ status: 200, body: "1158201444" });
  });
  it("rejects a wrong token with 403", () => {
    const r = verifyChallenge(q({ "hub.mode": "subscribe", "hub.verify_token": "bad", "hub.challenge": "1" }), "tok");
    expect(r.status).toBe(403);
    expect(r.body).not.toBe("1");
  });
  it("rejects a wrong mode with 403", () => {
    expect(verifyChallenge(q({ "hub.mode": "unsubscribe", "hub.verify_token": "tok", "hub.challenge": "1" }), "tok").status).toBe(403);
  });
  it.each([
    [{ "hub.verify_token": "tok", "hub.challenge": "1" }],
    [{ "hub.mode": "subscribe", "hub.challenge": "1" }],
    [{ "hub.mode": "subscribe", "hub.verify_token": "tok" }],
    [{}],
  ])("returns 400 when parameters are missing %j", (params) => {
    expect(verifyChallenge(q(params as Record<string, string>), "tok").status).toBe(400);
  });
  it("accepts a raw query string, with or without ?", () => {
    const s = "hub.mode=subscribe&hub.verify_token=tok&hub.challenge=abc";
    expect(verifyChallenge(s, "tok").body).toBe("abc");
    expect(verifyChallenge(`?${s}`, "tok").body).toBe("abc");
  });
  it("accepts an Express style query object", () => {
    const r = verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "9" }, "tok");
    expect(r.status).toBe(200);
  });
  it("accepts array values from a parsed query", () => {
    const r = verifyChallenge({ "hub.mode": ["subscribe"], "hub.verify_token": ["tok"], "hub.challenge": ["9"] }, "tok");
    expect(r.body).toBe("9");
  });
  it("never validates against an empty configured token", () => {
    const r = verifyChallenge(q({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }), "");
    expect(r.status).toBe(403);
  });
  it("rejects tokens that differ only in length", () => {
    expect(verifyChallenge(q({ "hub.mode": "subscribe", "hub.verify_token": "tok2", "hub.challenge": "1" }), "tok").status).toBe(403);
  });
  it("is case sensitive for the token", () => {
    expect(verifyChallenge(q({ "hub.mode": "subscribe", "hub.verify_token": "TOK", "hub.challenge": "1" }), "tok").status).toBe(403);
  });
  it("handles unicode tokens", () => {
    const r = verifyChallenge(q({ "hub.mode": "subscribe", "hub.verify_token": "টোকেন", "hub.challenge": "1" }), "টোকেন");
    expect(r.status).toBe(200);
  });
});

describe("verifySignature", () => {
  const secret = "app-secret";
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const header = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts a valid signature", () => {
    expect(verifySignature(body, header, secret)).toBe(true);
  });
  it("accepts Uint8Array and Buffer bodies", () => {
    expect(verifySignature(new TextEncoder().encode(body), header, secret)).toBe(true);
    expect(verifySignature(Buffer.from(body), header, secret)).toBe(true);
  });
  it("accepts an uppercase hex digest", () => {
    expect(verifySignature(body, `sha256=${header.slice(7).toUpperCase()}`, secret)).toBe(true);
  });
  it("accepts an array header (Node style)", () => {
    expect(verifySignature(body, [header], secret)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifySignature(body + " ", header, secret)).toBe(false);
  });
  it("rejects the wrong secret", () => {
    expect(verifySignature(body, header, "other")).toBe(false);
  });
  it("rejects re-serialised JSON with different whitespace", () => {
    expect(verifySignature(JSON.stringify(JSON.parse(body), null, 2), header, secret)).toBe(false);
  });
  it.each([undefined, null, "", "sha256=", "sha256=abc", "sha1=" + "a".repeat(40), "a".repeat(64), `sha256=${"z".repeat(64)}`, `sha256=${"0".repeat(63)}`, `sha256=${"0".repeat(65)}`])(
    "rejects malformed header %j",
    (h) => {
      expect(verifySignature(body, h as string, secret)).toBe(false);
    },
  );
  it("rejects when the secret is empty", () => {
    expect(verifySignature(body, header, "")).toBe(false);
  });
  it("tolerates surrounding whitespace in the header", () => {
    expect(verifySignature(body, ` ${header} `, secret)).toBe(true);
  });
  it("signPayload round-trips with verifySignature", () => {
    expect(verifySignature(body, signPayload(body, secret), secret)).toBe(true);
  });
  it("matches a known HMAC-SHA256 vector", () => {
    // RFC 4231 style check using a fixed key/message computed independently.
    expect(signPayload("what do ya want for nothing?", "Jefe")).toBe(
      "sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });
  it("handles multi-byte bodies byte-exactly", () => {
    const b = JSON.stringify({ text: "বাংলা 😀" });
    expect(verifySignature(b, signPayload(b, secret), secret)).toBe(true);
  });
});

describe("verifyAndParse", () => {
  const secret = "s";
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { display_phone_number: "1", phone_number_id: "2" },
              messages: [{ id: "wamid.1", from: "880", timestamp: "1", type: "text", text: { body: "hi" } }],
            },
          },
        ],
      },
    ],
  };
  const raw = JSON.stringify(payload);

  it("parses after a valid signature", () => {
    const events = verifyAndParse(raw, signPayload(raw, secret), secret);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("message");
  });
  it("throws on a bad signature", () => {
    expect(() => verifyAndParse(raw, "sha256=" + "0".repeat(64), secret)).toThrow(/signature/);
  });
  it("throws on invalid JSON even when signed", () => {
    const bad = "{not json";
    expect(() => verifyAndParse(bad, signPayload(bad, secret), secret)).toThrow(WhatsAppError);
  });
  it("accepts Uint8Array bodies", () => {
    const bytes = new TextEncoder().encode(raw);
    expect(verifyAndParse(bytes, signPayload(bytes, secret), secret)).toHaveLength(1);
  });
});
