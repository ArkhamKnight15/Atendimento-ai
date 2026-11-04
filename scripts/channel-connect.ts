/**
 * Conecta um número da WhatsApp Cloud API a uma empresa.
 *
 *   WHATSAPP_ACCESS_TOKEN=<token> npm run channel:connect -- \
 *     --tenant odontovita --phone-number-id 123456789012345 --waba-id 987654321 [--name "WhatsApp principal"]
 *
 * O token é lido de variável de ambiente (não aparece no histórico do shell como argumento),
 * validado na Graph API, criptografado e salvo. O app é inscrito nos webhooks da WABA.
 * Use --skip-meta para apenas gravar (sem chamar a Meta).
 */
import "./load-env";
import { parseArgs } from "node:util";
import { createSql } from "../src/server/db/client";
import { requireEnv } from "../src/server/env";
import { connectWhatsAppChannel } from "../src/server/tenant-config/channels";

const { values } = parseArgs({
  options: {
    tenant: { type: "string" },
    "phone-number-id": { type: "string" },
    "waba-id": { type: "string" },
    name: { type: "string", default: "WhatsApp principal" },
    "skip-meta": { type: "boolean", default: false },
  },
});

const tenant = values.tenant;
const phoneNumberId = values["phone-number-id"];
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
if (!tenant || !phoneNumberId || !accessToken) {
  console.error("Uso: WHATSAPP_ACCESS_TOKEN=<token> npm run channel:connect -- --tenant <slug> --phone-number-id <id> [--waba-id <id>]");
  process.exit(1);
}

const version = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v24.0";
const graph = async (path: string, init?: RequestInit) => {
  const response = await fetch(`https://graph.facebook.com/${version}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = body.error as { message?: string; code?: number } | undefined;
    throw new Error(`Graph API (${response.status}): ${error?.message ?? "erro desconhecido"} [código ${error?.code ?? "?"}]`);
  }
  return body;
};

let displayPhoneNumber: string | null = null;
if (!values["skip-meta"]) {
  try {
    const info = await graph(`${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
    displayPhoneNumber = (info.display_phone_number as string | undefined) ?? null;
    console.log(`✔ Número verificado na Meta: ${displayPhoneNumber} — ${info.verified_name ?? "sem nome verificado"} (qualidade: ${info.quality_rating ?? "n/d"})`);
    if (values["waba-id"]) {
      await graph(`${values["waba-id"]}/subscribed_apps`, { method: "POST" });
      console.log("✔ App inscrito nos webhooks da WABA");
    } else {
      console.warn("! Sem --waba-id: inscreva o app nos webhooks da WABA manualmente (POST /<WABA_ID>/subscribed_apps).");
    }
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

const sql = createSql(requireEnv("DATABASE_URL"), { max: 1 });
try {
  const result = await connectWhatsAppChannel(sql, {
    tenantSlug: tenant,
    phoneNumberId,
    wabaId: values["waba-id"] ?? null,
    displayPhoneNumber,
    name: values.name ?? "WhatsApp principal",
    accessToken,
    encryptionKey: requireEnv("CREDENTIALS_ENCRYPTION_KEY"),
  });
  console.log(`✔ Canal ${result.created ? "criado" : "atualizado"} (channel_id: ${result.channelId}). Token salvo criptografado.`);
} catch (error) {
  console.error(`✖ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
