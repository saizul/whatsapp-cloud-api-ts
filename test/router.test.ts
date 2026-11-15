import { describe, expect, it, vi } from "vitest";
import { MemoryDedupeStore, WebhookRouter, WhatsAppError, eventDedupeKey } from "../src/index.js";
import type { DedupeStore, MessageEvent, StatusEvent, WebhookEvent } from "../src/index.js";

const metadata = { display_phone_number: "15550001111", phone_number_id: "PNID" };
const NOW_S = 1_700_000_000;
const now = () => NOW_S * 1000;

function message(id: string, type = "text", timestamp = String(NOW_S)): MessageEvent {
  const base = { id, from: "8801700000000", timestamp };
  const m =
    type === "text"
      ? { ...base, type: "text" as const, text: { body: `body ${id}` } }
      : { ...base, type: "image" as const, image: { id: "M1", mime_type: "image/jpeg" } };
  return { kind: "message", entryId: "WABA1", metadata, contact: undefined, message: m };
}

function status(id: string, value: string, timestamp = String(NOW_S)): StatusEvent {
  return { kind: "status", entryId: "WABA1", metadata, status: { id, status: value, timestamp, recipient_id: "880" } };
}

const errorEvent: WebhookEvent = { kind: "error", entryId: "WABA1", metadata, errors: [{ code: 131000 }] };

describe("WebhookRouter routing", () => {
  it("routes messages by type, specific handlers before wildcard", async () => {
    const order: string[] = [];
    const router = new WebhookRouter({ now })
      .onMessage("*", () => void order.push("any"))
      .onMessage("text", () => void order.push("text"))
      .onMessage("image", () => void order.push("image"));
    const result = await router.dispatch([message("a"), message("b", "image")]);
    expect(order).toEqual(["text", "any", "image", "any"]);
    expect(result.handled).toBe(2);
    expect(result.outcomes).toEqual(["handled", "handled"]);
  });

  it("accepts a handler without a type as a wildcard", async () => {
    const seen: string[] = [];
    await new WebhookRouter({ now }).onMessage(({ message: m }) => void seen.push(m.id)).dispatch([message("x")]);
    expect(seen).toEqual(["x"]);
  });

  it("routes statuses by value and error events", async () => {
    const delivered = vi.fn();
    const all = vi.fn();
    const errors = vi.fn();
    const router = new WebhookRouter({ now }).onStatus("delivered", delivered).onStatus(all).onError(errors);
    const result = await router.dispatch([status("s1", "sent"), status("s1", "delivered"), errorEvent]);
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledWith(errorEvent);
    expect(result.handled).toBe(3);
  });

  it("counts events without handlers as unhandled", async () => {
    const router = new WebhookRouter({ now }).onMessage("image", vi.fn());
    const result = await router.dispatch([message("a"), status("s", "read"), errorEvent]);
    expect(result).toMatchObject({ handled: 0, unhandled: 3, outcomes: ["unhandled", "unhandled", "unhandled"] });
  });

  it("parses a raw payload passed to dispatch", async () => {
    const handler = vi.fn();
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              field: "messages",
              value: { metadata, messages: [{ id: "wamid.1", from: "880", timestamp: String(NOW_S), type: "text", text: { body: "hi" } }] },
            },
          ],
        },
      ],
    };
    const result = await new WebhookRouter({ now }).onMessage("text", handler).dispatch(payload);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.handled).toBe(1);
  });

  it("rejects missing handlers and bad options", () => {
    const router = new WebhookRouter();
    // @ts-expect-error deliberate misuse
    expect(() => router.onMessage("text")).toThrow(WhatsAppError);
    // @ts-expect-error deliberate misuse
    expect(() => router.onStatus("read")).toThrow(WhatsAppError);
    // @ts-expect-error deliberate misuse
    expect(() => router.onError(undefined)).toThrow(WhatsAppError);
    expect(() => new WebhookRouter({ dedupeTtlMs: 0 })).toThrow(/dedupeTtlMs/);
    expect(() => new WebhookRouter({ maxAgeSeconds: -1 })).toThrow(/maxAgeSeconds/);
    expect(() => new MemoryDedupeStore({ maxEntries: 0 })).toThrow(/maxEntries/);
  });
});

describe("WebhookRouter deduplication", () => {
  it("skips a redelivered message within one batch and across batches", async () => {
    const handler = vi.fn();
    const router = new WebhookRouter({ now }).onMessage("text", handler);
    const first = await router.dispatch([message("dup"), message("dup")]);
    const second = await router.dispatch([message("dup")]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(first.duplicates).toBe(1);
    expect(second.outcomes).toEqual(["duplicate"]);
  });

  it("treats each status transition of one message as distinct", async () => {
    const handler = vi.fn();
    const router = new WebhookRouter({ now }).onStatus(handler);
    await router.dispatch([status("w", "sent"), status("w", "delivered"), status("w", "delivered"), status("w", "read")]);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("never deduplicates error events", async () => {
    const handler = vi.fn();
    await new WebhookRouter({ now }).onError(handler).dispatch([errorEvent, errorEvent]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("releases the key when a handler throws so a retry is handled", async () => {
    let calls = 0;
    const router = new WebhookRouter({ now }).onMessage("text", () => {
      calls++;
      if (calls === 1) throw new Error("db down");
    });
    const first = await router.dispatch([message("r")]);
    expect(first.outcomes).toEqual(["failed"]);
    expect(first.failures).toHaveLength(1);
    expect((first.failures[0]!.error as Error).message).toBe("db down");
    const retry = await router.dispatch([message("r")]);
    expect(retry.outcomes).toEqual(["handled"]);
    expect(calls).toBe(2);
  });

  it("keeps running other handlers and events after a failure", async () => {
    const after = vi.fn();
    const router = new WebhookRouter({ now })
      .onMessage("text", async () => {
        throw new Error("boom");
      })
      .onMessage("*", after);
    const result = await router.dispatch([message("a"), message("b")]);
    expect(after).toHaveBeenCalledTimes(2);
    expect(result.failures).toHaveLength(2);
    expect(result.handled).toBe(0);
  });

  it("can be disabled", async () => {
    const handler = vi.fn();
    await new WebhookRouter({ now, dedupe: false }).onMessage(handler).dispatch([message("d"), message("d")]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("uses a custom async store with the configured TTL", async () => {
    const seen = new Set<string>();
    const store: DedupeStore = {
      claim: vi.fn(async (key: string) => {
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
      release: vi.fn(async (key: string) => void seen.delete(key)),
    };
    const handler = vi.fn();
    const router = new WebhookRouter({ now, dedupe: store, dedupeTtlMs: 60_000 }).onMessage(handler);
    await router.dispatch([message("c"), message("c")]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.claim).toHaveBeenCalledWith("message:c", 60_000);
  });
});

describe("WebhookRouter maxAgeSeconds", () => {
  it("skips events older than the limit and keeps fresh ones", async () => {
    const handler = vi.fn();
    const router = new WebhookRouter({ now, maxAgeSeconds: 300 }).onMessage(handler).onStatus(handler);
    const result = await router.dispatch([
      message("old", "text", String(NOW_S - 301)),
      message("edge", "text", String(NOW_S - 300)),
      status("s", "read", String(NOW_S - 3600)),
    ]);
    expect(result.outcomes).toEqual(["stale", "handled", "stale"]);
    expect(result.stale).toBe(2);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not record stale events as seen", async () => {
    const store = new MemoryDedupeStore({ now });
    const router = new WebhookRouter({ now, dedupe: store, maxAgeSeconds: 60 }).onMessage(vi.fn());
    await router.dispatch([message("old", "text", String(NOW_S - 120))]);
    expect(store.size).toBe(0);
  });

  it("handles events with an unparseable timestamp", async () => {
    const handler = vi.fn();
    await new WebhookRouter({ now, maxAgeSeconds: 60 }).onMessage(handler).dispatch([message("t", "text", "n/a")]);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("MemoryDedupeStore", () => {
  it("expires keys after the TTL", () => {
    let t = 0;
    const store = new MemoryDedupeStore({ now: () => t });
    expect(store.claim("k", 1000)).toBe(true);
    expect(store.claim("k", 1000)).toBe(false);
    t = 1000;
    expect(store.size).toBe(0);
    expect(store.claim("k", 1000)).toBe(true);
  });

  it("evicts the oldest keys beyond maxEntries", () => {
    const store = new MemoryDedupeStore({ maxEntries: 2, now: () => 0 });
    store.claim("a", 10);
    store.claim("b", 10);
    store.claim("c", 10);
    expect(store.size).toBe(2);
    expect(store.claim("a", 10)).toBe(true);
    expect(store.claim("c", 10)).toBe(false);
  });

  it("release and clear forget keys", () => {
    const store = new MemoryDedupeStore();
    store.claim("a", 1000);
    store.claim("b", 1000);
    store.release("a");
    expect(store.claim("a", 1000)).toBe(true);
    store.clear();
    expect(store.size).toBe(0);
  });
});

describe("eventDedupeKey", () => {
  it("builds stable keys", () => {
    expect(eventDedupeKey(message("m1"))).toBe("message:m1");
    expect(eventDedupeKey(status("m1", "read"))).toBe("status:m1:read");
    expect(eventDedupeKey(errorEvent)).toBeUndefined();
  });
});
