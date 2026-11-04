import { runAgent, type AgentRunResult } from "../ai/agent";
import type { Db } from "../db/client";
import { loadAgentContext } from "../db/context";
import {
  countRecentInbound,
  getHistory,
  getPendingInbound,
  insertOutboundMessages,
  markInboundProcessed,
  markPrivacyNoticeSent,
  resumeConversationBot,
  setConversationHandoff,
  setMarketingOptOut,
} from "../db/conversations";
import { emitEvent } from "../db/events";
import { flagUsageThreshold, getMonthlyUsage, incrementUsage, usagePeriod } from "../db/usage";
import type { AgentContext, MessageSender } from "../domain";
import { effectiveLimits } from "../domain";
import { splitMessage } from "../lib/text";
import type { Deps } from "./deps";
import { errorMessage, isRetryable } from "./errors";
import {
  automationEnabled,
  detectConsentKeyword,
  optInConfirmation,
  optOutConfirmation,
  privacyNotice,
  RATE_LIMITS,
  USAGE_WARNING_RATIO,
} from "./guardrails";
import { flushPendingOutbound, getWhatsAppCredentials } from "./outbound";

/** Mensagens anteriores enviadas ao modelo como contexto. */
export const HISTORY_LIMIT = 30;

export type ProcessOutcome =
  | "no_pending"
  | "automation_disabled"
  | "human_mode"
  | "consent_keyword"
  | "rate_limited"
  | "usage_limit"
  | "replied"
  | "fallback";

export interface ProcessOptions {
  /** Na última tentativa, erros transitórios viram resposta de contingência em vez de nova tentativa. */
  finalAttempt: boolean;
}

async function reply(
  db: Db,
  ctx: AgentContext,
  input: { text: string; sender: MessageSender; inboundIds: string[]; agentRunId: string | null; at: Date },
) {
  const parts = splitMessage(input.text);
  await insertOutboundMessages(db, {
    tenantId: ctx.tenant.id,
    conversationId: ctx.conversation.id,
    sender: input.sender,
    parts,
    agentRunId: input.agentRunId,
    at: input.at,
  });
  await markInboundProcessed(db, {
    tenantId: ctx.tenant.id,
    ids: input.inboundIds,
    status: "received",
    agentRunId: input.agentRunId,
    at: input.at,
  });
  return parts.length;
}

async function handOff(db: Db, ctx: AgentContext, reason: string, summary: string, at: Date) {
  const until = new Date(at.getTime() + ctx.agent.handoffTimeoutMinutes * 60_000);
  await setConversationHandoff(db, { tenantId: ctx.tenant.id, conversationId: ctx.conversation.id, reason, summary, at, until });
  await emitEvent(db, {
    tenantId: ctx.tenant.id,
    type: "conversation.handoff_requested",
    payload: {
      conversationId: ctx.conversation.id,
      reason,
      summary,
      contact: { name: ctx.contact.name ?? ctx.contact.profileName, phone: ctx.contact.phone },
      whatsappLink: ctx.contact.phone ? `https://wa.me/${ctx.contact.phone}` : null,
      automationPausedUntil: until.toISOString(),
    },
    at,
  });
  await incrementUsage(db, ctx.tenant.id, usagePeriod(at, ctx.tenant.timezone), { handoffs: 1 });
}

async function recordRun(db: Db, ctx: AgentContext, run: AgentRunResult): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into public.agent_runs
      (tenant_id, conversation_id, model, effort, status, stop_reason, llm_calls, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, cost_usd_micros, tool_calls, latency_ms, error)
    values
      (${ctx.tenant.id}, ${ctx.conversation.id}, ${run.model}, ${run.effort}, ${run.status}, ${run.stopReason},
       ${run.llmCalls}, ${run.usage.inputTokens}, ${run.usage.outputTokens}, ${run.usage.cacheReadTokens},
       ${run.usage.cacheWriteTokens}, ${run.costUsdMicros}, ${db.json(run.toolCalls as never)}, ${run.latencyMs}, ${run.error})
    returning id`;
  return row!.id;
}

/**
 * Processa as mensagens pendentes de uma conversa: aplica as regras
 * determinísticas (sem custo de IA) e, se for o caso, gera e envia a resposta.
 */
export async function processConversation(
  deps: Deps,
  tenantId: string,
  conversationId: string,
  options: ProcessOptions,
): Promise<ProcessOutcome> {
  const log = deps.logger.child({ tenantId, conversationId });
  const ctx = await loadAgentContext(deps.sql, tenantId, conversationId);
  if (!ctx) {
    log.warn("conversa não encontrada");
    return "no_pending";
  }

  // Retoma envios de uma tentativa anterior interrompida.
  await flushPendingOutbound(deps, ctx, log);

  const pending = await getPendingInbound(deps.sql, tenantId, conversationId);
  if (pending.length === 0) return "no_pending";
  const inboundIds = pending.map((m) => m.id);
  const now = deps.now();
  const markAll = (status: "received" | "ignored") =>
    markInboundProcessed(deps.sql, { tenantId, ids: inboundIds, status, at: now });

  const automation = automationEnabled(ctx);
  if (!automation.enabled) {
    log.info("automação desativada; mensagens apenas registradas", { reason: automation.reason });
    await markAll("received");
    return "automation_disabled";
  }

  if (ctx.conversation.status === "human") {
    if (ctx.conversation.handoffUntil && ctx.conversation.handoffUntil > now) {
      await markAll("received");
      return "human_mode";
    }
    await resumeConversationBot(deps.sql, tenantId, conversationId);
    ctx.conversation.status = "open";
    log.info("pausa de atendimento humano expirou; agente retomado");
  }

  // LGPD: descadastro/recadastro de comunicações comerciais, sem passar pela IA.
  const keyword = detectConsentKeyword(pending.at(-1)?.content ?? null);
  if (keyword) {
    await deps.sql.begin(async (tx) => {
      await setMarketingOptOut(tx, tenantId, ctx.contact.id, keyword === "opt_out" ? now : null);
      await emitEvent(tx, {
        tenantId,
        type: keyword === "opt_out" ? "contact.opted_out" : "contact.opted_in",
        payload: { contactId: ctx.contact.id, phone: ctx.contact.phone },
        at: now,
      });
      const text = keyword === "opt_out" ? optOutConfirmation(ctx.tenant.name) : optInConfirmation(ctx.tenant.name);
      const parts = await reply(tx, ctx, { text, sender: "system", inboundIds, agentRunId: null, at: now });
      await incrementUsage(tx, tenantId, usagePeriod(now, ctx.tenant.timezone), { outboundMessages: parts });
    });
    await flushPendingOutbound(deps, ctx, log);
    return "consent_keyword";
  }

  // Anti-abuso (custo): volume anormal de mensagens de um mesmo contato.
  const [lastMinute, lastDay] = await Promise.all([
    countRecentInbound(deps.sql, tenantId, ctx.contact.id, 60_000, now),
    countRecentInbound(deps.sql, tenantId, ctx.contact.id, 86_400_000, now),
  ]);
  if (lastMinute > RATE_LIMITS.perMinute || lastDay > RATE_LIMITS.perDay) {
    log.warn("limite de mensagens por contato excedido", { lastMinute, lastDay });
    await markAll("ignored");
    return "rate_limited";
  }

  // Consumo do mês. As respostas inclusas são um limite "macio": a IA continua atendendo e o
  // excedente é cobrado do cliente. Só o teto de custo de IA (trava de segurança) pausa a IA.
  const period = usagePeriod(now, ctx.tenant.timezone);
  const limits = effectiveLimits(ctx.plan, ctx.tenant);
  const usage = await getMonthlyUsage(deps.sql, tenantId, period);
  const payload = { period, usage, limits };
  if (usage.costUsdMicros >= limits.monthlyAiBudgetUsdMicros) {
    await deps.sql.begin(async (tx) => {
      if (await flagUsageThreshold(tx, tenantId, period, "budget", now)) {
        await emitEvent(tx, { tenantId, type: "usage.budget_exhausted", payload, dedupeKey: `usage.budget:${tenantId}:${period}`, at: now });
      }
      await handOff(tx, ctx, "usage_limit", "Teto mensal de custo de IA atingido (trava de segurança).", now);
      const parts = await reply(tx, ctx, { text: ctx.agent.handoffMessage, sender: "system", inboundIds, agentRunId: null, at: now });
      await incrementUsage(tx, tenantId, period, { outboundMessages: parts });
    });
    await flushPendingOutbound(deps, ctx, log);
    log.warn("teto de custo de IA atingido; conversa transferida");
    return "usage_limit";
  }
  const includedRatio = usage.aiReplies / limits.monthlyAiReplies;
  if (includedRatio >= 1 && (await flagUsageThreshold(deps.sql, tenantId, period, "reached", now))) {
    await emitEvent(deps.sql, { tenantId, type: "usage.limit_reached", payload, dedupeKey: `usage.reached:${tenantId}:${period}`, at: now });
  } else if (includedRatio >= USAGE_WARNING_RATIO && (await flagUsageThreshold(deps.sql, tenantId, period, "warning", now))) {
    await emitEvent(deps.sql, { tenantId, type: "usage.limit_warning", payload, dedupeKey: `usage.warning:${tenantId}:${period}`, at: now });
  }

  // Confirma leitura e mostra "digitando…" enquanto a IA trabalha (melhor esforço).
  const lastExternalId = pending.at(-1)?.externalId;
  if (lastExternalId) {
    getWhatsAppCredentials(deps, ctx)
      .then((credentials) => deps.whatsapp.markAsRead(credentials, lastExternalId))
      .catch((error) => log.debug("markAsRead falhou", { error: errorMessage(error) }));
  }

  const history = await getHistory(deps.sql, { tenantId, conversationId, limit: HISTORY_LIMIT, excludeIds: inboundIds });
  let run: AgentRunResult;
  try {
    run = await runAgent({
      llm: deps.llm,
      db: deps.sql,
      ctx,
      history,
      incoming: pending.map((m) => m.content ?? ""),
      now,
      logger: log,
    });
  } catch (error) {
    if (isRetryable(error) && !options.finalAttempt) throw error;
    log.error("falha definitiva ao gerar resposta", { error: errorMessage(error) });
    run = {
      status: "failed",
      reply: null,
      handoff: null,
      model: ctx.agent.aiModel ?? ctx.plan.aiModel,
      effort: ctx.agent.aiEffort ?? ctx.plan.aiEffort,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsdMicros: 0,
      llmCalls: 0,
      toolCalls: [],
      stopReason: null,
      latencyMs: 0,
      error: errorMessage(error),
    };
  }

  const succeeded = run.status === "succeeded" && run.reply;

  await deps.sql.begin(async (tx) => {
    const runId = await recordRun(tx, ctx, run);
    let text: string;
    let sender: MessageSender = "ai";

    if (succeeded) {
      text = run.reply!;
      // Transparência (LGPD): aviso de privacidade na primeira resposta ao contato.
      if (!ctx.contact.privacyNoticeSentAt && ctx.tenant.privacyPolicyUrl) {
        text = `${text}\n\n${privacyNotice(ctx.tenant.privacyPolicyUrl)}`;
        await markPrivacyNoticeSent(tx, tenantId, ctx.contact.id, now);
      }
    } else {
      // Recusa de segurança ou falha: nunca deixar o cliente sem resposta.
      text = ctx.agent.fallbackMessage;
      sender = "system";
      if (ctx.conversation.status !== "human") {
        const reason = run.status === "refused" ? "sensitive_topic" : "ai_failure";
        await handOff(tx, ctx, reason, `Resposta automática indisponível (${run.error ?? run.status}).`, now);
      }
    }

    const parts = await reply(tx, ctx, { text, sender, inboundIds, agentRunId: runId, at: now });
    await incrementUsage(tx, tenantId, period, {
      aiReplies: succeeded ? 1 : 0,
      outboundMessages: parts,
      tokens: run.usage,
      costUsdMicros: run.costUsdMicros,
    });
  });

  await flushPendingOutbound(deps, ctx, log);
  log.info("conversa respondida", {
    status: run.status,
    model: run.model,
    llmCalls: run.llmCalls,
    tools: run.toolCalls.map((t) => t.name),
    costUsdMicros: run.costUsdMicros,
    latencyMs: run.latencyMs,
  });
  return succeeded ? "replied" : "fallback";
}

/** Última tentativa esgotada por erro inesperado: avisa o cliente e chama um humano. */
export async function processConversationGaveUp(deps: Deps, tenantId: string, conversationId: string, error: string) {
  const log = deps.logger.child({ tenantId, conversationId });
  const ctx = await loadAgentContext(deps.sql, tenantId, conversationId);
  if (!ctx) return;
  const pending = await getPendingInbound(deps.sql, tenantId, conversationId);
  if (pending.length === 0) return;
  const now = deps.now();
  await deps.sql.begin(async (tx) => {
    if (ctx.conversation.status !== "human") await handOff(tx, ctx, "ai_failure", `Falha no processamento: ${error}`, now);
    await reply(tx, ctx, { text: ctx.agent.fallbackMessage, sender: "system", inboundIds: pending.map((m) => m.id), agentRunId: null, at: now });
  });
  await flushPendingOutbound(deps, ctx, log);
}
