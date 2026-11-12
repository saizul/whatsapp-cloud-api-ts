import { WhatsAppApiError, WhatsAppNetworkError, WhatsAppValidationError } from "./errors.js";
import type {
  ButtonsInput,
  ContactInput,
  CtaUrlInput,
  DocumentOptions,
  DownloadedMedia,
  InteractiveHeader,
  ListInput,
  LocationInput,
  LocationRequestInput,
  MarkAsReadOptions,
  MediaInfo,
  MediaOptions,
  MediaRef,
  SendMessageResponse,
  SendOptions,
  SendTextOptions,
  SuccessResponse,
  TemplateInput,
  UploadMediaResponse,
} from "./types.js";
import {
  assertButtons,
  assertCaption,
  assertCtaUrl,
  assertList,
  assertLocation,
  assertLocationRequest,
  assertMediaRef,
  assertMediaUpload,
  assertReaction,
  assertRecipient,
  assertText,
  normalizeRecipient,
} from "./validate.js";

/** Default Graph API version. Single source of truth; override per client with `apiVersion`. */
export const DEFAULT_API_VERSION = "v26.0";
export const DEFAULT_BASE_URL = "https://graph.facebook.com";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface WhatsAppClientOptions {
  /** System user or temporary access token. Keep it server side. */
  accessToken: string;
  /** The WhatsApp phone number id (not the phone number itself). */
  phoneNumberId: string;
  /** Graph API version. Defaults to {@link DEFAULT_API_VERSION}. */
  apiVersion?: string;
  /** Override for tests or a proxy. Default `https://graph.facebook.com`. */
  baseUrl?: string;
  /** Custom fetch implementation. Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Retries after the first attempt for 429 / 5xx / network errors. Default 3. */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms. Default 500. */
  retryBaseDelayMs?: number;
  /** Upper bound for a single backoff wait in ms. Default 30000. */
  retryMaxDelayMs?: number;
  /** Per-attempt timeout in ms. Default 30000. Use 0 to disable. */
  timeoutMs?: number;
  /** Run local validation of limits before sending. Default true. */
  validate?: boolean;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable random in [0,1) used for jitter (tests). */
  random?: () => number;
}

interface RequestOptions {
  query?: Record<string, string>;
  json?: unknown;
  form?: FormData;
  /** Absolute URL instead of a Graph path (used for media downloads). */
  absolute?: boolean;
}

function mediaObject(ref: MediaRef, filename?: string): Record<string, unknown> {
  const media: Record<string, unknown> = ref.id ? { id: ref.id } : { link: ref.link };
  if (filename) media.filename = filename;
  return media;
}

/** Convert the public header shape into the Graph API's `interactive.header`. */
function buildHeader(header: InteractiveHeader | undefined): Record<string, unknown> | undefined {
  if (!header) return undefined;
  if (typeof header === "string") return { type: "text", text: header };
  switch (header.type) {
    case "text":
      return header.text ? { type: "text", text: header.text } : undefined;
    case "image":
      return { type: "image", image: mediaObject(header.image) };
    case "video":
      return { type: "video", video: mediaObject(header.video) };
    case "document":
      return { type: "document", document: mediaObject(header.document, header.document.filename) };
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class WhatsAppClient {
  readonly phoneNumberId: string;
  readonly apiVersion: string;
  readonly baseUrl: string;

  readonly #token: string;
  readonly #fetch: FetchLike;
  readonly #maxRetries: number;
  readonly #baseDelay: number;
  readonly #maxDelay: number;
  readonly #timeout: number;
  readonly #validate: boolean;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #random: () => number;

  constructor(options: WhatsAppClientOptions) {
    if (!options?.accessToken) throw new WhatsAppValidationError("accessToken is required");
    if (!options.phoneNumberId) throw new WhatsAppValidationError("phoneNumberId is required");
    this.#token = options.accessToken;
    this.phoneNumberId = options.phoneNumberId;
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
    if (!/^v\d+\.\d+$/.test(this.apiVersion)) {
      throw new WhatsAppValidationError(`apiVersion must look like "${DEFAULT_API_VERSION}", got "${this.apiVersion}"`);
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    if (!options.fetch && typeof globalThis.fetch !== "function") {
      throw new WhatsAppValidationError("No fetch implementation available; pass `fetch` in options");
    }
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#maxRetries = options.maxRetries ?? 3;
    this.#baseDelay = options.retryBaseDelayMs ?? 500;
    this.#maxDelay = options.retryMaxDelayMs ?? 30_000;
    this.#timeout = options.timeoutMs ?? 30_000;
    this.#validate = options.validate ?? true;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
  }

  // ------------------------------------------------------------ messages

  /** Send a plain text message. */
  sendText(to: string, body: string, options: SendTextOptions = {}): Promise<SendMessageResponse> {
    if (this.#validate) assertText(body);
    const text: Record<string, unknown> = { body };
    if (options.previewUrl !== undefined) text.preview_url = options.previewUrl;
    return this.#message(to, "text", { text }, options);
  }

  /** Send an approved message template. */
  sendTemplate(to: string, template: TemplateInput, options: SendOptions = {}): Promise<SendMessageResponse> {
    if (!template?.name) throw new WhatsAppValidationError("template.name is required");
    if (!template.language) throw new WhatsAppValidationError("template.language is required");
    const payload: Record<string, unknown> = {
      name: template.name,
      language: { code: template.language },
    };
    if (template.components?.length) {
      payload.components = template.components.map((c) =>
        c.type === "button" ? { ...c, index: String(c.index) } : c,
      );
    }
    return this.#message(to, "template", { template: payload }, options);
  }

  sendImage(to: string, image: MediaRef, options: MediaOptions = {}): Promise<SendMessageResponse> {
    return this.#media(to, "image", image, options, options.caption);
  }

  sendVideo(to: string, video: MediaRef, options: MediaOptions = {}): Promise<SendMessageResponse> {
    return this.#media(to, "video", video, options, options.caption);
  }

  sendAudio(to: string, audio: MediaRef, options: SendOptions = {}): Promise<SendMessageResponse> {
    return this.#media(to, "audio", audio, options);
  }

  sendSticker(to: string, sticker: MediaRef, options: SendOptions = {}): Promise<SendMessageResponse> {
    return this.#media(to, "sticker", sticker, options);
  }

  sendDocument(to: string, document: MediaRef, options: DocumentOptions = {}): Promise<SendMessageResponse> {
    return this.#media(to, "document", document, options, options.caption, options.filename);
  }

  /**
   * Interactive message with up to three quick-reply buttons. The header may be
   * text or an image, video or document.
   */
  sendButtons(to: string, input: ButtonsInput, options: SendOptions = {}): Promise<SendMessageResponse> {
    if (this.#validate) assertButtons(input);
    const interactive: Record<string, unknown> = {
      type: "button",
      body: { text: input.body },
      action: {
        buttons: input.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })),
      },
    };
    return this.#interactive(to, interactive, input.header, input.footer, options);
  }

  /**
   * Interactive call-to-action message: a body with one button that opens `url`.
   * Use it instead of pasting raw links so the URL stays tidy behind a label.
   */
  sendCtaUrl(to: string, input: CtaUrlInput, options: SendOptions = {}): Promise<SendMessageResponse> {
    if (this.#validate) assertCtaUrl(input);
    const interactive: Record<string, unknown> = {
      type: "cta_url",
      body: { text: input.body },
      action: {
        name: "cta_url",
        parameters: { display_text: input.displayText, url: input.url },
      },
    };
    return this.#interactive(to, interactive, input.header, input.footer, options);
  }

  /**
   * Interactive message with a "Send location" button. The user's reply arrives
   * as an ordinary `location` message on the webhook.
   */
  sendLocationRequest(to: string, input: LocationRequestInput, options: SendOptions = {}): Promise<SendMessageResponse> {
    if (this.#validate) assertLocationRequest(input);
    const interactive: Record<string, unknown> = {
      type: "location_request_message",
      body: { text: input.body },
      action: { name: "send_location" },
    };
    return this.#interactive(to, interactive, undefined, undefined, options);
  }

  /** Interactive list message (up to 10 rows). */
  sendList(to: string, input: ListInput, options: SendOptions = {}): Promise<SendMessageResponse> {
    if (this.#validate) assertList(input);
    const interactive: Record<string, unknown> = {
      type: "list",
      body: { text: input.body },
      action: {
        button: input.buttonText,
        sections: input.sections.map((s) => ({
          ...(s.title ? { title: s.title } : {}),
          rows: s.rows.map((r) => ({
            id: r.id,
            title: r.title,
            ...(r.description ? { description: r.description } : {}),
          })),
        })),
      },
    };
    return this.#interactive(to, interactive, input.header, input.footer, options);
  }

  /** React to a message. Pass an empty string as `emoji` to remove a reaction. */
  sendReaction(to: string, messageId: string, emoji: string): Promise<SendMessageResponse> {
    if (this.#validate) assertReaction(messageId, emoji);
    return this.#message(to, "reaction", { reaction: { message_id: messageId, emoji } }, {});
  }

  sendLocation(to: string, location: LocationInput, options: SendOptions = {}): Promise<SendMessageResponse> {
    if (this.#validate) assertLocation(location.latitude, location.longitude);
    return this.#message(to, "location", { location }, options);
  }

  sendContacts(to: string, contacts: ContactInput[], options: SendOptions = {}): Promise<SendMessageResponse> {
    if (!Array.isArray(contacts) || contacts.length === 0) {
      throw new WhatsAppValidationError("contacts must contain at least one contact");
    }
    for (const c of contacts) {
      if (!c?.name?.formatted_name) throw new WhatsAppValidationError("each contact needs name.formatted_name");
    }
    return this.#message(to, "contacts", { contacts }, options);
  }

  /**
   * Mark an incoming message as read (shows blue ticks to the sender). Pass
   * `{ typingIndicator: true }` to also show "typing..." while you prepare a reply.
   */
  markAsRead(messageId: string, options: MarkAsReadOptions = {}): Promise<SuccessResponse> {
    if (typeof messageId !== "string" || messageId.trim() === "") {
      throw new WhatsAppValidationError("messageId is required");
    }
    const json: Record<string, unknown> = { messaging_product: "whatsapp", status: "read", message_id: messageId };
    if (options.typingIndicator) json.typing_indicator = { type: "text" };
    return this.#request<SuccessResponse>("POST", `${this.phoneNumberId}/messages`, { json });
  }

  /**
   * Show a typing indicator in reply to an incoming message. The API always marks
   * that message as read at the same time. Shorthand for
   * `markAsRead(messageId, { typingIndicator: true })`.
   */
  sendTypingIndicator(messageId: string): Promise<SuccessResponse> {
    return this.markAsRead(messageId, { typingIndicator: true });
  }

  /** Send an arbitrary, already-built message body (escape hatch for new message types). */
  sendRaw(body: Record<string, unknown>): Promise<SendMessageResponse> {
    return this.#request<SendMessageResponse>("POST", `${this.phoneNumberId}/messages`, {
      json: { messaging_product: "whatsapp", ...body },
    });
  }

  // --------------------------------------------------------------- media

  /**
   * Upload a file and receive a media id usable in `sendImage` etc. The MIME type
   * and size are checked locally against Meta's documented limits unless the
   * client was created with `validate: false`.
   */
  uploadMedia(data: Blob | Uint8Array | ArrayBuffer, mimeType: string, filename = "file"): Promise<UploadMediaResponse> {
    if (!mimeType) throw new WhatsAppValidationError("mimeType is required");
    const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mimeType });
    if (this.#validate) assertMediaUpload(mimeType, blob.size);
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", blob.type === mimeType ? blob : new Blob([blob], { type: mimeType }), filename);
    return this.#request<UploadMediaResponse>("POST", `${this.phoneNumberId}/media`, { form });
  }

  /** Look up the temporary download URL and metadata for a media id. */
  getMedia(mediaId: string): Promise<MediaInfo> {
    if (!mediaId) throw new WhatsAppValidationError("mediaId is required");
    return this.#request<MediaInfo>("GET", mediaId, { query: { phone_number_id: this.phoneNumberId } });
  }

  /**
   * Download media bytes. Accepts a media id (resolved via `getMedia`) or the
   * URL returned by it. Download URLs are short lived and require the token.
   */
  async downloadMedia(idOrUrl: string): Promise<DownloadedMedia> {
    if (!idOrUrl) throw new WhatsAppValidationError("idOrUrl is required");
    const url = /^https?:\/\//i.test(idOrUrl) ? idOrUrl : (await this.getMedia(idOrUrl)).url;
    const res = await this.#send("GET", url, { absolute: true });
    return {
      data: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? undefined,
    };
  }

  deleteMedia(mediaId: string): Promise<SuccessResponse> {
    if (!mediaId) throw new WhatsAppValidationError("mediaId is required");
    return this.#request<SuccessResponse>("DELETE", mediaId);
  }

  // ----------------------------------------------------------- internals

  #media(
    to: string,
    type: "image" | "video" | "audio" | "sticker" | "document",
    ref: MediaRef,
    options: SendOptions,
    caption?: string,
    filename?: string,
  ): Promise<SendMessageResponse> {
    if (this.#validate) {
      assertMediaRef(ref);
      assertCaption(caption);
    }
    const media = mediaObject(ref, filename);
    if (caption) media.caption = caption;
    return this.#message(to, type, { [type]: media }, options);
  }

  #interactive(
    to: string,
    interactive: Record<string, unknown>,
    header: InteractiveHeader | undefined,
    footer: string | undefined,
    options: SendOptions,
  ): Promise<SendMessageResponse> {
    const h = buildHeader(header);
    if (h) interactive.header = h;
    if (footer) interactive.footer = { text: footer };
    return this.#message(to, "interactive", { interactive }, options);
  }

  #message(to: string, type: string, content: Record<string, unknown>, options: SendOptions): Promise<SendMessageResponse> {
    if (this.#validate) assertRecipient(to);
    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizeRecipient(to),
      type,
      ...content,
    };
    if (options.replyTo) body.context = { message_id: options.replyTo };
    return this.#request<SendMessageResponse>("POST", `${this.phoneNumberId}/messages`, { json: body });
  }

  async #request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.#send(method, path, opts);
    const text = await res.text();
    if (text === "") return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new WhatsAppApiError(res.status, text);
    }
  }

  async #send(method: string, path: string, opts: RequestOptions): Promise<Response> {
    let url = opts.absolute ? path : `${this.baseUrl}/${this.apiVersion}/${path}`;
    if (opts.query) url += `?${new URLSearchParams(opts.query).toString()}`;

    const headers: Record<string, string> = { Authorization: `Bearer ${this.#token}` };
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      body = opts.form;
    }

    let attempt = 0;
    for (;;) {
      let res: Response | undefined;
      let networkError: unknown;
      try {
        const init: RequestInit = { method, headers, body };
        if (this.#timeout > 0) init.signal = AbortSignal.timeout(this.#timeout);
        res = await this.#fetch(url, init);
      } catch (err) {
        networkError = err;
      }

      if (res?.ok) return res;

      const retryable = res ? res.status === 429 || res.status >= 500 : true;
      if (retryable && attempt < this.#maxRetries) {
        await this.#sleep(this.#delay(attempt, res));
        attempt++;
        continue;
      }

      if (!res) {
        throw new WhatsAppNetworkError(
          `Network error calling ${method} ${url.split("?")[0]}: ${(networkError as Error)?.message ?? "unknown"}`,
          { cause: networkError },
        );
      }
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep raw text */
      }
      throw new WhatsAppApiError(res.status, parsed);
    }
  }

  #delay(attempt: number, res: Response | undefined): number {
    const retryAfter = res?.headers.get("retry-after");
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, this.#maxDelay);
    }
    const exp = Math.min(this.#baseDelay * 2 ** attempt, this.#maxDelay);
    // "equal jitter": half fixed, half random.
    return Math.round(exp / 2 + (this.#random() * exp) / 2);
  }
}
