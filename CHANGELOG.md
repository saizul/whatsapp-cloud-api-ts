# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `uploadMedia` now validates the MIME type and file size against Meta's documented
  limits before the request (disable with `validate: false`).
- Exported `MEDIA_LIMITS` and `getMediaKind(mimeType)`.

## [0.1.0] - 2026-11-08

### Added
- `WhatsAppClient` with text, template, image, video, audio, sticker, document,
  interactive buttons, interactive list, reaction, location and contacts messages.
- `markAsRead`, `uploadMedia`, `getMedia`, `downloadMedia`, `deleteMedia`.
- Typed `WhatsAppApiError` mapping Graph API error payloads, plus validation and
  network error classes.
- Retries with exponential backoff and jitter on 429, 5xx and network errors, with
  `Retry-After` support.
- Webhook helpers: `verifyChallenge`, `verifySignature` (timing safe HMAC-SHA256),
  `parseWebhook`, `verifyAndParse`, `getMessageText`.
- ESM and CJS builds with type declarations; example `node:http` server.
