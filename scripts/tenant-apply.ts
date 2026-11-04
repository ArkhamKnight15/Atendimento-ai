/**
 * Cadastra ou atualiza uma empresa a partir do arquivo de configuração.
 *
 *   npm run tenant:apply -- tenants/odontovita.json
 */
import "./load-env";
import { readFile } from "node:fs/promises";
import { createSql } from "../src/server/db/client";
import { requireEnv } from "../src/server/env";
import { applyTenantConfig } from "../src/server/tenant-config/apply";
import { parseTenantConfig } from "../src/server/tenant-config/schema";

const file = process.argv[2];
if (!file) {
  console.error("Uso: npm run tenant:apply -- tenants/<slug>.json");
  process.exit(1);
}

const sql = createSql(requireEnv("DATABASE_URL"), { max: 1 });
try {
  const config = parseTenantConfig(JSON.parse(await readFile(file, "utf8")));
  const result = await applyTenantConfig(sql, config);
  console.log(`${result.tenantCreated ? "✔ Empresa criada" : "✔ Empresa atualizada"}: ${config.name} (${config.slug})`);
  console.log(`  tenant_id: ${result.tenantId}`);
  console.log(`  agent_id:  ${result.agentId}`);
  console.log(
    `  catálogo: ${result.counts.catalog} | FAQs: ${result.counts.faqs} | conhecimento: ${result.counts.knowledge} | intervalos de horário: ${result.counts.businessHours}`,
  );
  console.log(`  base de conhecimento no prompt: ${result.knowledgeChars.toLocaleString("pt-BR")} caracteres`);
  if (result.tenantCreated) {
    console.log("\nPróximo passo: conecte o número de WhatsApp com `npm run channel:connect`.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
