import { InternalServerError } from "@anthropic-ai/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "../../src/server/db/client";
import { claimJob, enqueueJob, requeueStaleJobs } from "../../src/server/db/jobs";
import { generateKey, hmacSha256Hex } from "../../src/server/lib/crypto";
import { ingestWebhook } from "../../src/server/pipeline/ingest";
import { runDueJobs, runJobsWhenDue } from "../../src/server/pipeline/worker";
import { WhatsAppApiError } from "../../src/server/whatsapp/client";
import { parseWebhook } from "../../src/server/whatsapp/webhook";
import { createTestDatabase, TEST_DATABASE_URL } from "../helpers/db";
import { createTestDeps, llmMessage, text, toolUse, type TestDeps } from "../helpers/fakes";
import { createTenant, type TenantFixture } from "../helpers/fixtures";
import { inboundPayload, statusPayload, textMessage } from "../helpers/whatsapp-payloads";

const currentPeriod = () =>
  `${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7)}-01`;

const overloaded = () =>
  new InternalServerError(500, { type: "error", error: { type: "api_error", message: "overloaded" } }, "overloaded", new Headers());

describe.skipIf(!TEST_DATABASE_URL)("pipeline WhatsApp → IA → resposta", () => {
  let sql: Sql;
  let deps: TestDeps;
  let a: TenantFixture;
  let b: TenantFixture;
  const key = generateKey();
  let phoneSeq = 0;
  let phone: string;

  beforeAll(async () => {
    sql = await createTestDatabase();
    a = await createTenant(sql, { slug: "salao-a", phoneNumberId: "3000000003", encryptionKey: key, privacyPolicyUrl: "https://salao-a.example.com/privacidade" });
    b = await createTenant(sql, { slug: "salao-b", phoneNumberId: "4000000004", encryptionKey: key });
  });

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(() => {
    deps = createTestDeps(sql, { encryptionKey: key });
    phone = `55119${String(++phoneSeq).padStart(8, "0")}`;
  });

  /** Simula a entrega do webhook pela Meta + o processamento pós-resposta. */
  async function receive(tenant: TenantFixture, ...bodies: string[]) {
    const payload = inboundPayload({ phoneNumberId: tenant.phoneNumberId, from: phone, messages: bodies.map((body) => textMessage(body)) });
    const result = await ingestWebhook(deps, parseWebhook(payload));
    await runJobsWhenDue(deps, result.jobs);
    return { result, payload };
  }

  const conversationOf = async (tenantId: string) => {
    const [row] = await sql<{ id: string; status: string; handoffReason: string | null }[]>`
      select cv.id, cv.status, cv.handoff_reason from public.conversations cv
      join public.contacts c on c.id = cv.contact_id
      where cv.tenant_id = ${tenantId} and c.external_id = ${phone} and cv.status <> 'closed'`;
    return row;
  };

  it("responde uma mensagem, registra execução, consumo e aviso de privacidade", async () => {
    deps.llm.enqueue(text("Olá, Maria! O corte custa **R$ 60,00**."));
    await receive(a, "Oi, quanto custa o corte?");

    expect(deps.whatsapp.sent).toHaveLength(1);
    const sent = deps.whatsapp.sent[0]!;
    expect(sent.to).toBe(phone);
    expect(sent.credentials).toEqual({ phoneNumberId: a.phoneNumberId, accessToken: "token-salao-a" });
    expect(sent.body).toContain("*R$ 60,00*"); // Markdown convertido para WhatsApp
    expect(sent.body).toContain("Política de Privacidade: https://salao-a.example.com/privacidade");

    const call = deps.llm.calls[0]!;
    expect(call.model).toBe("claude-haiku-5-5");
    expect(JSON.stringify(call.system)).toContain("Corte de cabelo");
    expect(call.messages.at(-2)).toEqual({ role: "user", content: "Oi, quanto custa o corte?" });
    expect(call.messages.at(-1)?.role).toBe("system"); // contexto volátil fora do prompt em cache
    expect(call.tools?.map((t) => ("name" in t ? t.name : ""))).toEqual(["save_lead", "transfer_to_human"]);

    const [run] = await sql<{ status: string; costUsdMicros: number }[]>`select status, cost_usd_micros from public.agent_runs where tenant_id = ${a.tenantId} order by created_at desc limit 1`;
    expect(run).toMatchObject({ status: "succeeded", costUsdMicros: 95 });
    const [usage] = await sql<{ aiReplies: number; inboundMessages: number; outboundMessages: number }[]>`select * from public.usage_monthly where tenant_id = ${a.tenantId}`;
    expect(usage).toMatchObject({ aiReplies: 1, inboundMessages: 1, outboundMessages: 1 });

    // Segunda resposta: aviso de privacidade não se repete; histórico vai junto.
    deps.llm.enqueue(text("Temos horários amanhã."));
    await receive(a, "Tem horário amanhã?");
    expect(deps.whatsapp.sent[1]?.body).toBe("Temos horários amanhã.");
    const history = deps.llm.calls[1]!.messages.map((m) => m.role);
    expect(history).toEqual(["user", "assistant", "user", "system"]);
    expect(deps.problems).toEqual([]);
  });

  it("ignora reentregas do mesmo webhook (idempotência)", async () => {
    deps.llm.enqueue(text("Oi!"));
    const { payload } = await receive(a, "Olá");
    const again = await ingestWebhook(deps, parseWebhook(payload));
    expect(again).toMatchObject({ stored: 0, duplicates: 1, jobs: [] });
    expect(deps.llm.calls).toHaveLength(1);
    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from public.messages m join public.contacts c on c.tenant_id = m.tenant_id
      join public.conversations cv on cv.id = m.conversation_id and cv.contact_id = c.id
      where c.external_id = ${phone} and m.direction = 'inbound'`;
    expect(row?.count).toBe(1);
  });

  it("agrupa mensagens enviadas em sequência em uma única resposta", async () => {
    deps.llm.enqueue(text("Claro! Como posso ajudar?"));
    await receive(a, "oi", "tudo bem?", "queria uma informação");
    expect(deps.llm.calls).toHaveLength(1);
    expect(deps.llm.calls[0]!.messages.at(-2)).toEqual({ role: "user", content: "oi\ntudo bem?\nqueria uma informação" });
    expect(deps.whatsapp.sent).toHaveLength(1);
    expect(deps.problems).toEqual([]);
  });

  it("registra lead via ferramenta e entrega o evento assinado ao n8n", async () => {
    deps.llm.enqueue(
      toolUse("save_lead", { name: "Maria Souza", interest: "Coloração", temperature: "hot", qualification: [{ question: "Para quando precisa?", answer: "Sábado" }] }),
      text("Perfeito, Maria! Já anotei seu interesse."),
    );
    await receive(a, "Sou a Maria, quero fazer coloração no sábado");

    // A 2ª chamada devolve o resultado da ferramenta, mantendo o conteúdo do assistente intacto.
    const second = deps.llm.calls[1]!;
    const toolResult = second.messages.at(-1)!;
    expect(toolResult.role).toBe("user");
    expect(JSON.stringify(toolResult.content)).toContain("Lead registrado.");

    const [lead] = await sql<{ name: string; interest: string; temperature: string; stage: string; phone: string }[]>`
      select l.* from public.leads l join public.contacts c on c.id = l.contact_id
      where l.tenant_id = ${a.tenantId} and c.external_id = ${phone}`;
    expect(lead).toMatchObject({ name: "Maria Souza", interest: "Coloração", temperature: "hot", stage: "qualified", phone });

    // Entregas pendentes (lead.created + lead.hot) saem pela fila.
    const summary = await runDueJobs(deps, { limit: 20, budgetMs: 10_000 });
    expect(summary.done).toBeGreaterThanOrEqual(2);
    const delivered = deps.fetchCalls.filter((c) => c.url.endsWith("/salao-a"));
    const types = delivered.map((c) => (c.init.headers as Record<string, string>)["X-Webhook-Event"]);
    expect(types).toEqual(expect.arrayContaining(["lead.created", "lead.hot"]));

    const created = delivered.find((c) => (c.init.headers as Record<string, string>)["X-Webhook-Event"] === "lead.created")!;
    const headers = created.init.headers as Record<string, string>;
    const body = String(created.init.body);
    expect(headers["X-Webhook-Signature"]).toBe(`v1=${hmacSha256Hex(a.webhookSecret, `${headers["X-Webhook-Timestamp"]}.${body}`)}`);
    expect(JSON.parse(body)).toMatchObject({ type: "lead.created", tenant: { slug: "salao-a" }, data: { lead: { name: "Maria Souza" } } });
    expect(deps.problems).toEqual([]);
  });

  it("transfere para humano, pausa a IA e retoma após o prazo", async () => {
    deps.llm.enqueue(
      toolUse("transfer_to_human", { reason: "customer_request", summary: "Cliente quer falar com atendente sobre um pacote." }),
      text("Certo! Vou chamar alguém da equipe para continuar com você."),
    );
    await receive(a, "quero falar com uma pessoa");
    expect((await conversationOf(a.tenantId))?.status).toBe("human");

    // Durante a pausa: mensagem salva, sem IA e sem resposta automática.
    await receive(a, "alô?");
    expect(deps.llm.calls).toHaveLength(2);
    expect(deps.whatsapp.sent).toHaveLength(1);

    // Prazo expirado: o agente volta a responder.
    await sql`update public.conversations set handoff_until = now() - interval '1 minute' where tenant_id = ${a.tenantId} and status = 'human'`;
    deps.llm.enqueue(text("Oi! Estou de volta para ajudar."));
    await receive(a, "ainda estão aí?");
    expect((await conversationOf(a.tenantId))?.status).toBe("open");
    expect(deps.whatsapp.sent.at(-1)?.body).toBe("Oi! Estou de volta para ajudar.");
    // A mensagem enviada durante a pausa entra no histórico.
    expect(JSON.stringify(deps.llm.calls.at(-1)!.messages)).toContain("alô?");
    expect(deps.problems).toEqual([]);
  });

  it("processa descadastro (LGPD) sem chamar a IA", async () => {
    await receive(a, "SAIR");
    expect(deps.llm.calls).toHaveLength(0);
    expect(deps.whatsapp.sent[0]?.body).toContain("não vai mais receber mensagens promocionais");
    const [contact] = await sql<{ marketingOptOutAt: Date | null }[]>`
      select marketing_opt_out_at from public.contacts where tenant_id = ${a.tenantId} and external_id = ${phone}`;
    expect(contact?.marketingOptOutAt).toBeInstanceOf(Date);
  });

  it("isola empresas: o número de B só alimenta dados de B", async () => {
    deps.llm.enqueue(text("Olá da empresa B"));
    await receive(b, "oi");
    expect(deps.whatsapp.sent[0]?.credentials.accessToken).toBe("token-salao-b");
    expect(JSON.stringify(deps.llm.calls[0]!.system)).toContain("Empresa salao-b");
    const contactsInA = await sql`select 1 from public.contacts where tenant_id = ${a.tenantId} and external_id = ${phone}`;
    expect(contactsInA).toHaveLength(0);
    expect(deps.problems).toEqual([]);
  });

  it("acima das respostas inclusas a IA continua atendendo e o excedente é sinalizado uma vez", async () => {
    await sql`
      insert into public.usage_monthly (tenant_id, period, ai_replies) values (${b.tenantId}, ${currentPeriod()}, 5000)
      on conflict (tenant_id, period) do update set ai_replies = 5000, limit_reached_at = null, limit_warning_at = null`;
    deps.llm.enqueue(text("Claro, posso ajudar!"), text("Por nada!"));
    await receive(b, "olá");
    await receive(b, "obrigado");
    expect(deps.whatsapp.sent.map((m) => m.body)).toEqual(["Claro, posso ajudar!", "Por nada!"]);
    expect((await conversationOf(b.tenantId))?.status).toBe("open");
    const events = await sql`select 1 from private.events where tenant_id = ${b.tenantId} and type = 'usage.limit_reached'`;
    expect(events).toHaveLength(1);
    const [usage] = await sql<{ aiReplies: number }[]>`select ai_replies from public.usage_monthly where tenant_id = ${b.tenantId} and period = ${currentPeriod()}`;
    expect(usage?.aiReplies).toBe(5002);
    expect(deps.problems).toEqual([]);
  });

  it("ao atingir o teto de custo de IA (trava de segurança), transfere para humano sem gastar IA", async () => {
    await sql`
      update public.usage_monthly set cost_usd_micros = 10000000, budget_exhausted_at = null
      where tenant_id = ${b.tenantId} and period = ${currentPeriod()}`;
    await receive(b, "olá de novo");
    expect(deps.llm.calls).toHaveLength(0);
    expect(deps.whatsapp.sent[0]?.body).toBe("Vou chamar alguém da equipe para continuar com você.");
    expect(await conversationOf(b.tenantId)).toMatchObject({ status: "human", handoffReason: "usage_limit" });
    const events = await sql`select 1 from private.events where tenant_id = ${b.tenantId} and type = 'usage.budget_exhausted'`;
    expect(events).toHaveLength(1);
    await sql`update public.usage_monthly set ai_replies = 0, cost_usd_micros = 0, budget_exhausted_at = null where tenant_id = ${b.tenantId}`;
  });

  it("falha transitória da IA volta para a fila; na última tentativa o cliente recebe contingência", async () => {
    deps.llm.enqueue(overloaded());
    await receive(a, "bom dia");
    const [job] = await sql<{ id: number; status: string; attempts: number }[]>`
      select j.id, j.status, j.attempts from private.jobs j join public.conversations cv on cv.id = j.ref_id
      join public.contacts c on c.id = cv.contact_id where c.external_id = ${phone} and j.kind = 'process_conversation'
      order by j.id desc limit 1`;
    expect(job).toMatchObject({ status: "queued", attempts: 1 });
    expect(deps.whatsapp.sent).toHaveLength(0);

    // Simula a última tentativa: erro de novo → mensagem de contingência + transferência.
    await sql`update private.jobs set attempts = max_attempts - 1, run_at = now() where id = ${job!.id}`;
    deps.llm.enqueue(overloaded());
    await runDueJobs(deps, { limit: 5, budgetMs: 5000 });
    expect(deps.whatsapp.sent[0]?.body).toBe("Tive uma instabilidade. Nossa equipe vai continuar o atendimento.");
    expect(await conversationOf(a.tenantId)).toMatchObject({ status: "human", handoffReason: "ai_failure" });
  });

  it("recusa de segurança gera contingência e transferência", async () => {
    deps.llm.enqueue(llmMessage([], "refusal"));
    await receive(a, "mensagem qualquer");
    expect(deps.whatsapp.sent[0]?.body).toBe("Tive uma instabilidade. Nossa equipe vai continuar o atendimento.");
    expect(await conversationOf(a.tenantId)).toMatchObject({ status: "human", handoffReason: "sensitive_topic" });
  });

  it("atualiza status de entrega sem regredir e marca canal com token inválido", async () => {
    deps.llm.enqueue(text("Mensagem 1"));
    await receive(a, "oi");
    const externalId = deps.whatsapp.sent[0]!.externalId;
    for (const status of ["read", "delivered"]) {
      await ingestWebhook(deps, parseWebhook(statusPayload({ phoneNumberId: a.phoneNumberId, externalId, status })));
    }
    const [message] = await sql<{ status: string; readAt: Date | null }[]>`select status, read_at from public.messages where external_id = ${externalId}`;
    expect(message?.status).toBe("read");
    expect(message?.readAt).toBeInstanceOf(Date);

    deps.whatsapp.failNext = new WhatsAppApiError("Error validating access token", 401, 190);
    deps.llm.enqueue(text("Mensagem 2"));
    await receive(a, "outra");
    const [failed] = await sql<{ status: string; errorCode: string }[]>`
      select status, error_code from public.messages where tenant_id = ${a.tenantId} and content = 'Mensagem 2'`;
    expect(failed).toEqual({ status: "failed", errorCode: "190" });
    const [channel] = await sql<{ status: string }[]>`select status from public.channels where id = ${a.channelId}`;
    expect(channel?.status).toBe("error");
    await sql`update public.channels set status = 'active', last_error = null where id = ${a.channelId}`;
  });

  it("garante um único worker por conversa e recupera jobs travados", async () => {
    const conversationId = (await sql<{ id: string }[]>`select id from public.conversations limit 1`)[0]!.id;
    await sql`update private.jobs set status = 'done' where ref_id = ${conversationId}`;
    const job = await enqueueJob(sql, { tenantId: a.tenantId, kind: "process_conversation", refId: conversationId, runAt: new Date(Date.now() - 1000) });
    const claims = await Promise.all([claimJob(sql, job.id), claimJob(sql, job.id), claimJob(sql, job.id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);

    // Novo job da mesma conversa não roda enquanto o primeiro está em execução.
    const second = await enqueueJob(sql, { tenantId: a.tenantId, kind: "process_conversation", refId: conversationId, runAt: new Date(Date.now() - 1000) });
    expect(await claimJob(sql, second.id)).toBeNull();

    // Worker "morreu": lease expira; o travado é absorvido pelo que já aguarda na fila.
    await sql`update private.jobs set locked_until = now() - interval '1 second' where id = ${job.id}`;
    expect(await requeueStaleJobs(sql)).toBe(1);
    const statuses = await sql<{ id: number; status: string }[]>`select id, status from private.jobs where id in ${sql([job.id, second.id])} order by id`;
    expect(statuses.map((s) => s.status)).toEqual(["done", "queued"]);
  });
});
