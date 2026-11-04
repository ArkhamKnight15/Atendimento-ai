/**
 * Simulador de conversa no terminal — ferramenta de DESENVOLVIMENTO.
 *
 * Passa pelo pipeline real (ingestão, fila, regras, IA da Anthropic, ferramentas,
 * leads, eventos e consumo) e só troca o envio pela Graph API por impressão no
 * terminal. Serve para calibrar o agente de um cliente antes de ligar o WhatsApp.
 * Grava dados no banco de DATABASE_URL: use um banco de desenvolvimento.
 *
 *   npm run chat -- --tenant odontovita [--phone 5511999990000] [--name "Maria"]
 *
 * Comandos: /reset (nova conversa)  /sair
 */
import "./load-env";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { AnthropicLlmClient } from "../src/server/ai/llm";
import { createSql } from "../src/server/db/client";
import { requireEnv } from "../src/server/env";
import { encryptSecret } from "../src/server/lib/crypto";
import { createLogger } from "../src/server/lib/logger";
import { sleep, type Deps } from "../src/server/pipeline/deps";
import { ingestWebhook } from "../src/server/pipeline/ingest";
import { runJobsWhenDue } from "../src/server/pipeline/worker";
import type { WhatsAppClient } from "../src/server/whatsapp/client";

const { values } = parseArgs({
  options: {
    tenant: { type: "string" },
    phone: { type: "string", default: "5500000000001" },
    name: { type: "string", default: "Cliente Teste" },
  },
});
if (!values.tenant) {
  console.error("Uso: npm run chat -- --tenant <slug> [--phone 55DDDNUMERO] [--name Nome]");
  process.exit(1);
}

const databaseUrl = requireEnv("DATABASE_URL");
const encryptionKey = requireEnv("CREDENTIALS_ENCRYPTION_KEY");
const sql = createSql(databaseUrl, { max: 3 });
const phone = values.phone ?? "5500000000001";

const [tenant] = await sql<{ id: string; name: string }[]>`select id, name from public.tenants where slug = ${values.tenant}`;
const [agent] = tenant
  ? await sql<{ id: string; name: string }[]>`select id, name from public.agents where tenant_id = ${tenant.id} order by created_at limit 1`
  : [];
if (!tenant || !agent) {
  console.error(`Empresa "${values.tenant}" não encontrada (ou sem agente). Rode npm run tenant:apply antes.`);
  await sql.end();
  process.exit(1);
}

// Canal exclusivo do simulador (não é um número real da Meta).
const simulatorId = `simulador-${values.tenant}`;
const [channel] = await sql<{ id: string }[]>`
  insert into public.channels (tenant_id, agent_id, type, name, external_id, status)
  values (${tenant.id}, ${agent.id}, 'whatsapp', 'Simulador local (dev)', ${simulatorId}, 'active')
  on conflict (type, external_id) do update set status = 'active'
  returning id`;
await sql`
  insert into private.channel_credentials (channel_id, access_token_enc)
  values (${channel!.id}, ${encryptSecret("simulador", encryptionKey)})
  on conflict (channel_id) do nothing`;

let repliedThisTurn = false;
const terminal: WhatsAppClient = {
  async sendText(_credentials, _to, body) {
    repliedThisTurn = true;
    console.log(`\n\x1b[36m${agent.name}:\x1b[0m ${body}\n`);
    return { externalId: `sim.out.${randomUUID()}` };
  },
  async markAsRead() {},
};

const deps: Deps = {
  sql,
  llm: new AnthropicLlmClient(requireEnv("ANTHROPIC_API_KEY")),
  whatsapp: terminal,
  logger: createLogger({ service: "chat-simulator" }, "warn"),
  now: () => new Date(),
  encryptionKey,
  debounceMs: 0,
  fetch,
  sleep,
};

const host = new URL(databaseUrl).hostname;
console.log(`Simulador — ${tenant.name} | agente: ${agent.name} | banco: ${host}`);
console.log("Digite como se fosse o cliente. Comandos: /reset, /sair\n");

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.setPrompt("\x1b[33mVocê:\x1b[0m ");
rl.prompt();
try {
  // O iterador funciona tanto no terminal interativo quanto com entrada redirecionada (pipe).
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) {
      rl.prompt();
      continue;
    }
    if (line === "/sair") break;
    if (line === "/reset") {
      await sql`
        update public.conversations set status = 'closed', closed_at = now()
        where channel_id = ${channel!.id} and status <> 'closed'`;
      console.log("(nova conversa iniciada)\n");
      rl.prompt();
      continue;
    }

    const turnStartedAt = new Date();
    repliedThisTurn = false;
    const result = await ingestWebhook(deps, {
      statuses: [],
      messages: [
        {
          phoneNumberId: simulatorId,
          externalId: `sim.in.${randomUUID()}`,
          from: phone,
          profileName: values.name ?? null,
          sentAt: new Date(),
          type: "text",
          content: line,
          needsReply: true,
          raw: { from: phone, id: "simulador", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: line } },
        },
      ],
    });
    await runJobsWhenDue(deps, result.jobs);

    const [run] = await sql<{ status: string; toolCalls: { name: string }[]; costUsdMicros: number; inputTokens: number; cacheReadTokens: number; outputTokens: number; latencyMs: number }[]>`
      select r.* from public.agent_runs r join public.conversations c on c.id = r.conversation_id
      where c.channel_id = ${channel!.id} and r.created_at >= ${turnStartedAt}
      order by r.created_at desc limit 1`;
    if (!repliedThisTurn) {
      const [conversation] = await sql<{ status: string }[]>`
        select status from public.conversations where channel_id = ${channel!.id} and status <> 'closed'`;
      console.log(
        conversation?.status === "human"
          ? "\x1b[2m(IA pausada: conversa transferida para atendente humano. Use /reset para recomeçar.)\x1b[0m\n"
          : "\x1b[2m(sem resposta neste turno — veja os logs acima)\x1b[0m\n",
      );
    }
    if (run) {
      const tools = run.toolCalls.map((t) => t.name).join(", ") || "nenhuma";
      console.log(
        `\x1b[2m[${run.status} | ferramentas: ${tools} | tokens in/cache/out: ${run.inputTokens}/${run.cacheReadTokens}/${run.outputTokens} | US$ ${(run.costUsdMicros / 1e6).toFixed(5)} | ${run.latencyMs} ms]\x1b[0m\n`,
      );
    }
    rl.prompt();
  }
} finally {
  rl.close();
  await sql.end();
}
