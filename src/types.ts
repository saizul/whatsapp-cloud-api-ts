/** Reference to media either by hosted link or by an uploaded media id. */
export type MediaRef = { id: string; link?: undefined } | { link: string; id?: undefined };

export interface SendOptions {
  /** Reply to (quote) an earlier message by its `wamid`. */
  replyTo?: string;
}

export interface SendTextOptions extends SendOptions {
  /** Render a link preview for the first URL in the body. */
  previewUrl?: boolean;
}

export interface MediaOptions extends SendOptions {
  caption?: string;
}

export interface DocumentOptions extends MediaOptions {
  filename?: string;
}

// ---------- Templates ----------

export interface CurrencyParameter {
  fallback_value: string;
  code: string;
  amount_1000: number;
}

export type TemplateParameter =
  | { type: "text"; text: string; parameter_name?: string }
  | { type: "currency"; currency: CurrencyParameter }
  | { type: "date_time"; date_time: { fallback_value: string } }
  | { type: "image"; image: MediaRef }
  | { type: "document"; document: MediaRef & { filename?: string } }
  | { type: "video"; video: MediaRef }
  | { type: "payload"; payload: string }
  | { type: "coupon_code"; coupon_code: string }
  | { type: "action"; action: Record<string, unknown> };

export type TemplateComponent =
  | { type: "header" | "body"; parameters: TemplateParameter[] }
  | {
      type: "button";
      sub_type: "quick_reply" | "url" | "copy_code" | "catalog" | "mpm" | "flow" | "voice_call";
      /** Zero based position of the button. Sent to the API as a string. */
      index: number | string;
      parameters?: TemplateParameter[];
    };

export interface TemplateInput {
  name: string;
  /** Language code such as `en_US` or `bn`. */
  language: string;
  components?: TemplateComponent[];
}

// ---------- Interactive ----------

export interface ReplyButton {
  id: string;
  title: string;
}

/**
 * Header of an interactive message. A plain string is shorthand for a text
 * header. Media headers are supported by reply-button and CTA URL messages;
 * list messages only accept text headers.
 */
export type InteractiveHeader =
  | string
  | { type: "text"; text: string }
  | { type: "image"; image: MediaRef }
  | { type: "video"; video: MediaRef }
  | { type: "document"; document: MediaRef & { filename?: string } };

export interface ButtonsInput {
  body: string;
  buttons: ReplyButton[];
  header?: InteractiveHeader;
  footer?: string;
}

/** Interactive call-to-action message with a single button that opens a URL. */
export interface CtaUrlInput {
  body: string;
  /** Button label. */
  displayText: string;
  /** https URL opened when the button is tapped. */
  url: string;
  header?: InteractiveHeader;
  footer?: string;
}

/** Interactive message asking the recipient to share their location. */
export interface LocationRequestInput {
  body: string;
}

export interface MarkAsReadOptions {
  /**
   * Also show a typing indicator to the sender. It is dismissed when you reply
   * or after about 25 seconds, whichever comes first.
   */
  typingIndicator?: boolean;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title?: string;
  rows: ListRow[];
}

export interface ListInput {
  body: string;
  /** Label of the button that opens the list. */
  buttonText: string;
  sections: ListSection[];
  /** Text only; list messages do not support media headers. */
  header?: string;
  footer?: string;
}

// ---------- Location & contacts ----------

export interface LocationInput {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ContactInput {
  name: {
    formatted_name: string;
    first_name?: string;
    last_name?: string;
    middle_name?: string;
    suffix?: string;
    prefix?: string;
  };
  phones?: { phone: string; type?: string; wa_id?: string }[];
  emails?: { email: string; type?: string }[];
  urls?: { url: string; type?: string }[];
  addresses?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    country_code?: string;
    type?: string;
  }[];
  org?: { company?: string; department?: string; title?: string };
  birthday?: string;
}

// ---------- Responses ----------

export interface SendMessageResponse {
  messaging_product: "whatsapp";
  contacts: { input: string; wa_id: string }[];
  messages: { id: string; message_status?: string }[];
}

export interface SuccessResponse {
  success: boolean;
}

export interface UploadMediaResponse {
  id: string;
}

export interface MediaInfo {
  id: string;
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  messaging_product?: string;
}

export interface DownloadedMedia {
  data: Uint8Array;
  contentType: string | undefined;
}
