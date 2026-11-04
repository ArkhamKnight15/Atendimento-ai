/**
 * Cadastra um webhook de saída (ex.: workflow do n8n) para uma empresa.
 *
 *   npm run webhook:add -- --tenant odontovita --name n8n \
 *     --url https://n8n.suaagencia.com.br/webhook/atendimento \
 *     --events lead.created,lead.hot,conversation.handoff_requested
 *
 * O segredo de assinatura é exibido UMA vez: guarde-o na credencial do n8n.
 */
import "./load-env";
import { parseArgs } from "node:util";
import { createSql } from "../src/server/db/client";
import { requireEnv } from "../src/server/env";
import { addWebhookEndpoint } from "../src/server/tenant-config/webhooks";

const { values } = parseArgs({
  options: {
    tenant: { type: "string" },
    name: { type: "string", default: "n8n" },
    url: { type: "string" },
    events: { type: "string" },
  },
});

if (!values.tenant || !values.url || !values.events) {
  console.error("Uso: npm run webhook:add -- --tenant <slug> --url <https://...> --events evento1,evento2 [--name n8n]");
  process.exit(1);
}

const sql = createSql(requireEnv("DATABASE_URL"), { max: 1 });
try {
  const { endpointId, secret } = await addWebhookEndpoint(sql, {
    tenantSlug: values.tenant,
    name: values.name ?? "n8n",
    url: values.url,
    events: values.events.split(",").map((e) => e.trim()).filter(Boolean),
    encryptionKey: requireEnv("CREDENTIALS_ENCRYPTION_KEY"),
  });
  console.log(`✔ Webhook salvo (endpoint_id: ${endpointId})`);
  console.log(`  Segredo de assinatura (guarde agora, não será exibido de novo): ${secret}`);
} catch (error) {
  console.error(`✖ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
