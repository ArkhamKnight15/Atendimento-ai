import { z } from "zod";

/**
 * Parser tolerante do webhook da WhatsApp Cloud API (campo `messages`).
 * Campos desconhecidos são preservados; só exigimos o que usamos.
 */
const mediaSchema = z.object({ id: z.string(), mime_type: z.string().optional(), caption: z.string().optional() }).loose();

const messageSchema = z
  .object({
    from: z.string(),
    id: z.string(),
    timestamp: z.string(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
    interactive: z
      .object({
        type: z.string(),
        button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
        list_reply: z.object({ id: z.string(), title: z.string(), description: z.string().optional() }).optional(),
      })
      .loose()
      .optional(),
    button: z.object({ text: z.string(), payload: z.string().optional() }).optional(),
    location: z
      .object({
        latitude: z.number(),
        longitude: z.number(),
        name: z.string().optional(),
        address: z.string().optional(),
      })
      .optional(),
    image: mediaSchema.optional(),
    video: mediaSchema.optional(),
    document: mediaSchema.extend({ filename: z.string().optional() }).optional(),
    audio: mediaSchema.optional(),
    sticker: mediaSchema.optional(),
    reaction: z.object({ message_id: z.string(), emoji: z.string().optional() }).optional(),
  })
  .loose();

const statusSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    timestamp: z.string(),
    recipient_id: z.string().optional(),
    errors: z
      .array(z.object({ code: z.number(), title: z.string().optional(), message: z.string().optional() }).loose())
      .optional(),
  })
  .loose();

const valueSchema = z
  .object({
    messaging_product: z.literal("whatsapp"),
    metadata: z.object({ display_phone_number: z.string().optional(), phone_number_id: z.string() }),
    contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
    messages: z.array(messageSchema).optional(),
    statuses: z.array(statusSchema).optional(),
  })
  .loose();

const webhookSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })),
    }),
  ),
});

type RawMessage = z.infer<typeof messageSchema>;

export interface InboundMessage {
  phoneNumberId: string;
  externalId: string;
  from: string;
  profileName: string | null;
  sentAt: Date;
  type: string;
  /** Representação em texto entregue ao agente. */
  content: string;
  /** `false` para eventos que não pedem resposta (reações, mensagens de sistema). */
  needsReply: boolean;
  raw: RawMessage;
}

export interface StatusUpdate {
  phoneNumberId: string;
  externalId: string;
  status: "sent" | "delivered" | "read" | "failed";
  at: Date;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ParsedWebhook {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
}

function describeMedia(kind: string, caption?: string): string {
  const base = `[O cliente enviou ${kind}. Você não consegue ver o conteúdo do arquivo.`;
  return caption ? `${base} Legenda: "${caption}"]` : `${base}]`;
}

export function describeMessage(message: RawMessage): { content: string; needsReply: boolean } {
  switch (message.type) {
    case "text":
      return { content: message.text?.body ?? "", needsReply: true };
    case "interactive": {
      const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
      return { content: reply?.title ?? "[Resposta interativa]", needsReply: true };
    }
    case "button":
      return { content: message.button?.text ?? "[Botão]", needsReply: true };
    case "location": {
      const loc = message.location;
      const label = [loc?.name, loc?.address].filter(Boolean).join(" — ");
      return { content: `[Localização compartilhada${label ? `: ${label}` : ""}]`, needsReply: true };
    }
    case "image":
      return { content: describeMedia("uma imagem", message.image?.caption), needsReply: true };
    case "video":
      return { content: describeMedia("um vídeo", message.video?.caption), needsReply: true };
    case "document":
      return { content: describeMedia("um documento", message.document?.caption), needsReply: true };
    case "audio":
      return {
        content: "[O cliente enviou um áudio. Você não consegue ouvir áudios: peça gentilmente que escreva a mensagem.]",
        needsReply: true,
      };
    case "sticker":
      return { content: "[O cliente enviou uma figurinha]", needsReply: true };
    case "contacts":
      return { content: "[O cliente compartilhou um cartão de contato]", needsReply: true };
    case "order":
      return { content: "[O cliente enviou um pedido pelo catálogo do WhatsApp]", needsReply: true };
    case "reaction":
      return { content: `[Reação ${message.reaction?.emoji ?? "removida"}]`, needsReply: false };
    case "system":
      return { content: "[Mensagem de sistema do WhatsApp]", needsReply: false };
    default:
      return { content: "[Mensagem de um tipo não suportado]", needsReply: true };
  }
}

const STATUS_VALUES = new Set(["sent", "delivered", "read", "failed"]);

/** Lança erro apenas se o envelope não for da WhatsApp Cloud API. */
export function parseWebhook(body: unknown): ParsedWebhook {
  const envelope = webhookSchema.parse(body);
  const result: ParsedWebhook = { messages: [], statuses: [] };

  for (const entry of envelope.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const value = valueSchema.safeParse(change.value);
      if (!value.success) continue;
      const { metadata, contacts = [], messages = [], statuses = [] } = value.data;
      const names = new Map(contacts.map((c) => [c.wa_id, c.profile?.name ?? null]));

      for (const message of messages) {
        const { content, needsReply } = describeMessage(message);
        result.messages.push({
          phoneNumberId: metadata.phone_number_id,
          externalId: message.id,
          from: message.from,
          profileName: names.get(message.from) ?? null,
          sentAt: new Date(Number(message.timestamp) * 1000),
          type: message.type,
          content,
          needsReply,
          raw: message,
        });
      }

      for (const status of statuses) {
        if (!STATUS_VALUES.has(status.status)) continue;
        const error = status.errors?.[0];
        result.statuses.push({
          phoneNumberId: metadata.phone_number_id,
          externalId: status.id,
          status: status.status as StatusUpdate["status"],
          at: new Date(Number(status.timestamp) * 1000),
          errorCode: error ? String(error.code) : null,
          errorMessage: error ? (error.message ?? error.title ?? null) : null,
        });
      }
    }
  }
  return result;
}
