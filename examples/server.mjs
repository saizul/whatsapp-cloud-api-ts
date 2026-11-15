// Minimal WhatsApp webhook + auto-reply server using only node:http.
// Run:  npm run build && \
//   WHATSAPP_TOKEN=... PHONE_NUMBER_ID=... APP_SECRET=... VERIFY_TOKEN=... node examples/server.mjs
import { createServer } from "node:http";
import {
  WebhookRouter,
  WhatsAppClient,
  getMessageText,
  verifyAndParse,
  verifyChallenge,
} from "../dist/index.js";

const { WHATSAPP_TOKEN, PHONE_NUMBER_ID, APP_SECRET, VERIFY_TOKEN, PORT = "3000" } = process.env;
if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID || !APP_SECRET || !VERIFY_TOKEN) {
  console.error("Set WHATSAPP_TOKEN, PHONE_NUMBER_ID, APP_SECRET and VERIFY_TOKEN");
  process.exit(1);
}

const wa = new WhatsAppClient({ accessToken: WHATSAPP_TOKEN, phoneNumberId: PHONE_NUMBER_ID });

// Meta redelivers webhooks; the router skips events it has already handled
// and, with maxAgeSeconds, does not answer messages queued during an outage.
const router = new WebhookRouter({ maxAgeSeconds: 15 * 60 })
  .onStatus(({ status }) => console.log(`status ${status.status} for ${status.id}`))
  .onMessage(async ({ message }) => {
    await wa.markAsRead(message.id);

    const text = (getMessageText(message) ?? "").toLowerCase();
    if (text === "menu") {
      await wa.sendButtons(message.from, {
        body: "How can I help?",
        buttons: [
          { id: "pricing", title: "Pricing" },
          { id: "human", title: "Talk to a human" },
        ],
      });
    } else {
      await wa.sendText(message.from, `You said: ${getMessageText(message) ?? `[${message.type}]`}`, {
        replyTo: message.id,
      });
    }
  });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/webhook") {
    res.writeHead(404).end();
    return;
  }
  if (req.method === "GET") {
    const r = verifyChallenge(url.searchParams, VERIFY_TOKEN);
    res.writeHead(r.status, { "Content-Type": "text/plain" }).end(r.body);
    return;
  }
  if (req.method === "POST") {
    try {
      const raw = await readBody(req); // raw bytes: needed for the signature
      const events = verifyAndParse(raw, req.headers["x-hub-signature-256"], APP_SECRET);
      res.writeHead(200).end(); // acknowledge quickly, work afterwards
      const result = await router.dispatch(events);
      for (const f of result.failures) console.error(f.error instanceof Error ? f.error.message : f.error);
    } catch (err) {
      console.error("rejected webhook:", err.message);
      if (!res.headersSent) res.writeHead(401).end();
    }
    return;
  }
  res.writeHead(405).end();
}).listen(Number(PORT), () => console.log(`listening on :${PORT}/webhook`));
