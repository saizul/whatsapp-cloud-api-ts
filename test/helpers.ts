import { vi } from "vitest";
import { WhatsAppClient } from "../src/index.js";
import type { WhatsAppClientOptions } from "../src/index.js";

export interface Call {
  url: string;
  init: RequestInit;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const OK_SEND = {
  messaging_product: "whatsapp",
  contacts: [{ input: "8801700000000", wa_id: "8801700000000" }],
  messages: [{ id: "wamid.TEST" }],
};

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A fetch mock that plays queued responses in order and records calls. */
export function mockFetch(...queue: (Response | Error | (() => Response))[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        /* leave raw */
      }
    }
    calls.push({ url, init: init ?? {}, body });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next();
    return (next ?? jsonResponse(OK_SEND)).clone();
  });
  return { fn, calls };
}

export function makeClient(
  fetchMock: ReturnType<typeof mockFetch>,
  overrides: Partial<WhatsAppClientOptions> = {},
) {
  const sleeps: number[] = [];
  const client = new WhatsAppClient({
    accessToken: "TOKEN",
    phoneNumberId: "1234567890",
    fetch: fetchMock.fn as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    ...overrides,
  });
  return { client, sleeps };
}
