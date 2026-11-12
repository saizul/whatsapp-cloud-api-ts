# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- Default Graph API version is now `v26.0`, defined once as the exported
  `DEFAULT_API_VERSION` constant (previously `v21.0`). Pass `apiVersion` to pin another.
- Re-checked interactive reply-button and list limits against Meta's docs.

### Added
- `uploadMedia` now validates the MIME type and file size against Meta's documented
  limits before the request (disable with `validate: false`).
- Exported `MEDIA_LIMITS` and `getMediaKind(mimeType)`.
- `sendCtaUrl` for interactive call-to-action URL button messages, with local
  validation of the label (max 20 characters, `LIMITS.ctaDisplayText`) and URL.
- `sendLocationRequest` for interactive "Send location" request messages.
- `sendButtons` and `sendCtaUrl` accept image, video and document headers via the
  new `InteractiveHeader` type; a string is still a text header. `sendList` rejects
  media headers, which the API does not support for lists.
- `markAsRead(messageId, { typingIndicator: true })` and the `sendTypingIndicator`
  shorthand show a typing indicator while a reply is prepared.

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
