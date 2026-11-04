/** Payloads no formato do webhook da WhatsApp Cloud API (campo "messages"). */
let sequence = 0;

export function inboundPayload(input: {
  phoneNumberId: string;
  from: string;
  name?: string;
  messages: Record<string, unknown>[];
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "5511900000000", phone_number_id: input.phoneNumberId },
              contacts: [{ profile: { name: input.name ?? "Maria Silva" }, wa_id: input.from }],
              messages: input.messages.map((m) => ({
                from: input.from,
                id: `wamid.in.${++sequence}.${Math.random().toString(36).slice(2)}`,
                timestamp: String(Math.floor(Date.now() / 1000)),
                ...m,
              })),
            },
          },
        ],
      },
    ],
  };
}

export const textMessage = (body: string, id?: string) => ({ type: "text", text: { body }, ...(id ? { id } : {}) });

export function statusPayload(input: { phoneNumberId: string; externalId: string; status: string; errors?: unknown[] }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "5511900000000", phone_number_id: input.phoneNumberId },
              statuses: [
                {
                  id: input.externalId,
                  status: input.status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: "5511988887777",
                  ...(input.errors ? { errors: input.errors } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
