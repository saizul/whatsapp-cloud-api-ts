# whatsapp-cloud-api-ts

A typed, zero-dependency TypeScript client for the **Meta WhatsApp Business Cloud API**, with webhook helpers (challenge, signature check, typed event parsing).

- Zero runtime dependencies, uses the global `fetch` (Node 22+).
- ESM and CommonJS builds, strict TypeScript types.
- Retries with exponential backoff on 429 / 5xx / network failures.
- Timing-safe `X-Hub-Signature-256` verification.
- Base URL and fetch are injectable, so tests never touch the network.

## Install

```bash
npm install whatsapp-cloud-api-ts
```


## Install from GitHub Packages

Releases are also published to [GitHub Packages](https://github.com/saizul/whatsapp-cloud-api-ts/pkgs/npm/whatsapp-cloud-api-ts) as `@saizul/whatsapp-cloud-api-ts`:

```bash
echo "@saizul:registry=https://npm.pkg.github.com" >> .npmrc
npm install @saizul/whatsapp-cloud-api-ts
```

GitHub Packages needs a personal access token with `read:packages` in your `~/.npmrc` (`//npm.pkg.github.com/:_authToken=YOUR_TOKEN`).

## Send messages

```ts
import { WhatsAppClient } from "whatsapp-cloud-api-ts";

const wa = new WhatsAppClient({
  accessToken: process.env.WHATSAPP_TOKEN!, // server side only
  phoneNumberId: process.env.PHONE_NUMBER_ID!,
  apiVersion: "v21.0", // default; configurable
});

await wa.sendText("8801XXXXXXXXX", "Hello from Saizul's bot", { previewUrl: true });

await wa.sendTemplate("8801XXXXXXXXX", {
  name: "order_update",
  language: "en_US",
  components: [{ type: "body", parameters: [{ type: "text", text: "#1042" }] }],
});

await wa.sendImage("8801XXXXXXXXX", { link: "https://example.com/a.jpg" }, { caption: "Look" });
await wa.sendDocument("8801XXXXXXXXX", { id: "MEDIA_ID" }, { filename: "invoice.pdf" });

await wa.sendButtons("8801XXXXXXXXX", {
  body: "Choose one",
  buttons: [{ id: "yes", title: "Yes" }, { id: "no", title: "No" }],
});

await wa.sendList("8801XXXXXXXXX", {
  body: "Our menu",
  buttonText: "Open",
  sections: [{ title: "Plans", rows: [{ id: "basic", title: "Basic", description: "Starter" }] }],
});

await wa.sendReaction("8801XXXXXXXXX", "wamid.XXX", "👍");
await wa.sendLocation("8801XXXXXXXXX", { latitude: 23.81, longitude: 90.41, name: "Dhaka" });
await wa.sendContacts("8801XXXXXXXXX", [{ name: { formatted_name: "Saizul Amin" } }]);
await wa.markAsRead("wamid.INCOMING");
```

Also available: `sendVideo`, `sendAudio`, `sendSticker`, and `sendRaw` for message types not yet modelled.

### Media

```ts
const { id } = await wa.uploadMedia(bytes, "image/png", "logo.png");
await wa.sendImage(to, { id });

const { data, contentType } = await wa.downloadMedia(incomingMediaId); // id or URL
await wa.deleteMedia(id);
```

### Errors

```ts
import { WhatsAppApiError } from "whatsapp-cloud-api-ts";

try {
  await wa.sendText(to, "hi");
} catch (e) {
  if (e instanceof WhatsAppApiError) {
    console.log(e.status, e.code, e.subcode, e.type, e.fbtraceId, e.details);
    if (e.isAuthError) /* token expired (190) */;
    if (e.isRateLimited) /* back off */;
  }
}
```

`WhatsAppValidationError` is thrown before any request for bad input (bad phone format, too many buttons, ...). `WhatsAppNetworkError` is thrown when the request could not complete after retries.

### Retries

HTTP 429, 5xx and network errors are retried up to `maxRetries` (default 3) with exponential backoff (`retryBaseDelayMs`, default 500, capped by `retryMaxDelayMs`) and jitter. A `Retry-After` header is honoured. 4xx errors other than 429 are never retried. Note that retrying a send after an ambiguous failure can, rarely, deliver a message twice; set `maxRetries: 0` if you need at-most-once.

## Webhooks

```ts
import { verifyChallenge, verifyAndParse, getMessageText } from "whatsapp-cloud-api-ts";

// GET /webhook
const r = verifyChallenge(url.searchParams, process.env.VERIFY_TOKEN!);
res.writeHead(r.status).end(r.body);

// POST /webhook  (use the RAW body, before JSON.parse)
const events = verifyAndParse(rawBody, req.headers["x-hub-signature-256"], process.env.APP_SECRET!);
for (const e of events) {
  if (e.kind === "message") console.log(e.message.type, getMessageText(e.message));
  if (e.kind === "status") console.log(e.status.status, e.status.id);
}
```

Events are a discriminated union (`kind: "message" | "status" | "error"`). Message `type` covers text, image, video, audio, document, sticker, location, contacts, interactive (button/list replies), template button, reaction, order, system and unsupported; unknown future types pass through untouched.

A complete `node:http` server (no Express) is in [`examples/server.mjs`](examples/server.mjs): `npm run build`, set `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `APP_SECRET`, `VERIFY_TOKEN`, then `node examples/server.mjs`.

## Verified vs. uncertain

Checked against Meta's published docs: the `POST /{phone-number-id}/messages` endpoint, the `messaging_product`/`recipient_type`/`to`/`type` envelope, the text `preview_url` flag, "up to three" reply buttons, and the webhook challenge and `X-Hub-Signature-256` scheme.

Not independently re-verified here (Meta's documentation pages are largely client-rendered and may change): the local validation limits in `LIMITS` (button title 20, list row title 24, description 72, 10 rows, body 1024, text 4096, caption 1024), the set of rate-limit error codes treated as retry hints (`4, 17, 80007, 130429, 131048`, used for `isRateLimited` only; retries key off HTTP status), and template button `index` being sent as a string. If Meta changes a limit, pass `validate: false`. The default API version is `v21.0`; newer versions exist, pass `apiVersion` to use one. Group messaging, BSUID addressing, Flows and the typing indicator are not modelled; use `sendRaw`.

## Bangla (বাংলা)

এটি Meta WhatsApp Business Cloud API-এর জন্য একটি টাইপ-সেফ, কোনো ডিপেন্ডেন্সি ছাড়া TypeScript ক্লায়েন্ট। টেক্সট, টেমপ্লেট, ছবি/ডকুমেন্ট/অডিও/ভিডিও, বাটন ও লিস্ট মেসেজ, রিঅ্যাকশন, লোকেশন ও কন্টাক্ট পাঠানো যায়। ওয়েবহুক যাচাই (`hub.challenge` ও `X-Hub-Signature-256` HMAC) এবং ইনকামিং ইভেন্ট পার্স করার হেল্পার আছে। অ্যাক্সেস টোকেন ও অ্যাপ সিক্রেট কখনো ব্রাউজারে বা পাবলিক রিপোতে রাখবেন না; শুধু সার্ভারে এনভায়রনমেন্ট ভেরিয়েবলে রাখুন। ফোন নম্বর আন্তর্জাতিক ফরম্যাটে (যেমন `8801XXXXXXXXX`) দিন। ওয়েবহুকে সিগনেচার যাচাইয়ের জন্য অবশ্যই raw body ব্যবহার করুন।

## Development

```bash
npm install
npm run check   # typecheck + lint + test + build
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Not affiliated with Meta or WhatsApp.

## License

MIT (c) Saizul Amin, https://saizul.com
