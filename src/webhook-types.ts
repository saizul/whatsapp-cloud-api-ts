/** Fields common to every inbound message. */
export interface BaseIncomingMessage {
  /** The message id (`wamid...`). */
  id: string;
  /** Sender's WhatsApp id (phone number, digits only). */
  from: string;
  /** Unix timestamp in seconds, as a string (as sent by Meta). */
  timestamp: string;
  /** Present when the message is a reply to / quotes another message. */
  context?: { from?: string; id?: string; forwarded?: boolean; frequently_forwarded?: boolean };
}

export interface MediaPayload {
  id: string;
  mime_type: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
  animated?: boolean;
}

export type IncomingMessage =
  | (BaseIncomingMessage & { type: "text"; text: { body: string } })
  | (BaseIncomingMessage & { type: "image"; image: MediaPayload })
  | (BaseIncomingMessage & { type: "video"; video: MediaPayload })
  | (BaseIncomingMessage & { type: "audio"; audio: MediaPayload })
  | (BaseIncomingMessage & { type: "document"; document: MediaPayload })
  | (BaseIncomingMessage & { type: "sticker"; sticker: MediaPayload })
  | (BaseIncomingMessage & {
      type: "location";
      location: { latitude: number; longitude: number; name?: string; address?: string; url?: string };
    })
  | (BaseIncomingMessage & { type: "contacts"; contacts: Record<string, unknown>[] })
  | (BaseIncomingMessage & {
      type: "interactive";
      interactive:
        | { type: "button_reply"; button_reply: { id: string; title: string } }
        | { type: "list_reply"; list_reply: { id: string; title: string; description?: string } }
        | { type: string; [key: string]: unknown };
    })
  /** Quick-reply button tapped on a template message. */
  | (BaseIncomingMessage & { type: "button"; button: { payload: string; text: string } })
  | (BaseIncomingMessage & { type: "reaction"; reaction: { message_id: string; emoji?: string } })
  | (BaseIncomingMessage & { type: "order"; order: Record<string, unknown> })
  | (BaseIncomingMessage & { type: "system"; system: Record<string, unknown> })
  | (BaseIncomingMessage & { type: "unsupported"; errors?: WebhookError[] })
  /** Forward compatibility: types this library does not know yet. */
  | (BaseIncomingMessage & { type: string; [key: string]: unknown });

export interface WebhookError {
  code: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
  href?: string;
}

export type MessageStatusValue = "sent" | "delivered" | "read" | "failed" | "deleted" | (string & {});

export interface MessageStatus {
  /** The id of the outbound message this status is about. */
  id: string;
  status: MessageStatusValue;
  timestamp: string;
  recipient_id: string;
  conversation?: {
    id: string;
    expiration_timestamp?: string;
    origin?: { type: string };
  };
  pricing?: { billable?: boolean; pricing_model?: string; category?: string; type?: string };
  errors?: WebhookError[];
}

export interface ContactProfile {
  wa_id: string;
  profile?: { name?: string };
}

export interface WebhookMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface MessageEvent {
  kind: "message";
  entryId: string;
  metadata: WebhookMetadata;
  /** Contact profile of the sender, when Meta included it. */
  contact: ContactProfile | undefined;
  message: IncomingMessage;
}

export interface StatusEvent {
  kind: "status";
  entryId: string;
  metadata: WebhookMetadata;
  status: MessageStatus;
}

/** Errors reported at the value level (`value.errors`). */
export interface ErrorEvent {
  kind: "error";
  entryId: string;
  metadata: WebhookMetadata;
  errors: WebhookError[];
}

export type WebhookEvent = MessageEvent | StatusEvent | ErrorEvent;

/** Raw webhook envelope. */
export interface WebhookPayload {
  object: string;
  entry: {
    id: string;
    changes: {
      field: string;
      value: {
        messaging_product?: string;
        metadata?: WebhookMetadata;
        contacts?: ContactProfile[];
        messages?: IncomingMessage[];
        statuses?: MessageStatus[];
        errors?: WebhookError[];
      };
    }[];
  }[];
}
