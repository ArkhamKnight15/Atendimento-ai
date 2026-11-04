/**
 * Envia ao endpoint um webhook no formato da Meta, assinado com META_APP_SECRET.
 * Útil para validar um ambiente (local, preview ou produção) sem depender do celular.
 *
 *   META_APP_SECRET=... npm run webhook:smoke -- \
 *     --url http://localhost:3000/api/webhooks/whatsapp \
 *     --phone-number-id 123456789012345 --from 5511999990000 --text "Oi, quanto custa?"
 *
 * Atenção: a resposta da IA será enviada de verdade para o número --from
 * se o canal tiver um token válido.
 */
import "./load-env";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { requireEnv } from "../src/server/env";
import { hmacSha256Hex } from "../src/server/lib/crypto";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3000/api/webhooks/whatsapp" },
    "phone-number-id": { type: "string" },
    from: { type: "string", default: "5500000000001" },
    name: { type: "string", default: "Teste" },
    text: { type: "string", default: "Olá!" },
    "message-id": { type: "string" },
  },
});
if (!values["phone-number-id"]) {
  console.error("Uso: npm run webhook:smoke -- --phone-number-id <id> [--url ...] [--from 55...] [--text ...]");
  process.exit(1);
}

const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "SMOKE_TEST",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "0000000000", phone_number_id: values["phone-number-id"] },
            contacts: [{ profile: { name: values.name }, wa_id: values.from }],
            messages: [
              {
                from: values.from,
                id: values["message-id"] ?? `wamid.smoke.${randomUUID()}`,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: "text",
                text: { body: values.text },
              },
            ],
          },
        },
      ],
    },
  ],
});

const response = await fetch(values.url!, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Hub-Signature-256": `sha256=${hmacSha256Hex(requireEnv("META_APP_SECRET"), body)}`,
  },
  body,
});
console.log(`${response.status} ${await response.text()}`);
process.exitCode = response.ok ? 0 : 1;
