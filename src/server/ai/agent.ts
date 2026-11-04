import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db/client";
import type { HistoryItem } from "../db/conversations";
import type { AgentContext, Effort, SupportedModel } from "../domain";
import type { Logger } from "../lib/logger";
import { toWhatsAppFormatting } from "../lib/text";
import type { LlmClient } from "./llm";
import { addUsage, costUsdMicros, emptyUsage, type TokenUsage } from "./pricing";
import { buildSystemPrompt, buildTurnContext } from "./prompt";
import { buildTools, executeTool } from "./tools";

/** Limite de iterações do loop de ferramentas por resposta (proteção de custo). */
export const MAX_AGENT_ITERATIONS = 4;
const MAX_OUTPUT_TOKENS = 8192;

export interface ToolCallRecord {
  name: string;
  ok: boolean;
  ms: number;
}

export interface AgentRunResult {
  status: "succeeded" | "failed" | "refused";
  reply: string | null;
  handoff: { reason: string; summary: string } | null;
  model: SupportedModel;
  effort: Effort;
  usage: TokenUsage;
  costUsdMicros: number;
  llmCalls: number;
  toolCalls: ToolCallRecord[];
  stopReason: string | null;
  latencyMs: number;
  error: string | null;
}

export interface RunAgentInput {
  llm: LlmClient;
  db: Db;
  ctx: AgentContext;
  history: HistoryItem[];
  /** Mensagens novas do cliente (já agrupadas pelo debounce). */
  incoming: string[];
  now: Date;
  logger: Logger;
}

function toMessageParams(history: HistoryItem[]): Anthropic.MessageParam[] {
  const params: Anthropic.MessageParam[] = history.map((item) =>
    item.sender === "contact"
      ? { role: "user", content: item.content }
      : { role: "assistant", content: item.sender === "human" ? `[Mensagem do atendente humano]\n${item.content}` : item.content },
  );
  // A conversa enviada à API precisa começar pelo usuário.
  while (params[0]?.role === "assistant") params.shift();
  return params;
}

export async function runAgent(input: RunAgentInput): Promise<AgentRunResult> {
  const { llm, db, ctx, now, logger } = input;
  const started = Date.now();
  const model = ctx.agent.aiModel ?? ctx.plan.aiModel;
  const effort = ctx.agent.aiEffort ?? ctx.plan.aiEffort;
  const isFirstReply = !input.history.some((h) => h.sender !== "contact");

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: buildSystemPrompt(ctx), cache_control: { type: "ephemeral" } },
  ];
  const tools = buildTools(ctx);
  const messages: Anthropic.MessageParam[] = [
    ...toMessageParams(input.history),
    { role: "user", content: input.incoming.join("\n") },
    { role: "system", content: buildTurnContext(ctx, now, isFirstReply) },
  ];

  const result: AgentRunResult = {
    status: "failed",
    reply: null,
    handoff: null,
    model,
    effort,
    usage: emptyUsage(),
    costUsdMicros: 0,
    llmCalls: 0,
    toolCalls: [],
    stopReason: null,
    latencyMs: 0,
    error: null,
  };

  for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
    const response = await llm.createMessage({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      tools,
      thinking: { type: "adaptive" },
      output_config: { effort },
      // Cache automático do último bloco: as iterações do loop reaproveitam o prefixo.
      cache_control: { type: "ephemeral" },
      messages,
    });

    const callUsage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    result.usage = addUsage(result.usage, callUsage);
    result.costUsdMicros += costUsdMicros(model, callUsage);
    result.llmCalls += 1;
    result.stopReason = response.stop_reason;

    if (response.stop_reason === "refusal") {
      result.status = "refused";
      result.error = response.stop_details?.category ? `refusal:${response.stop_details.category}` : "refusal";
      break;
    }

    if (response.stop_reason === "tool_use" || response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason === "pause_turn") continue;

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const toolStarted = Date.now();
        const outcome = await executeTool({ db, ctx, now }, block.name, block.input);
        result.toolCalls.push({ name: block.name, ok: !outcome.isError, ms: Date.now() - toolStarted });
        if (outcome.handoff) result.handoff = outcome.handoff;
        if (outcome.isError) logger.warn("tool returned error", { tool: block.name, error: outcome.result });
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: outcome.result, is_error: outcome.isError });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (text) {
      result.reply = toWhatsAppFormatting(text);
      result.status = "succeeded";
    } else if (result.handoff) {
      result.reply = ctx.agent.handoffMessage;
      result.status = "succeeded";
    } else {
      result.error = `resposta vazia (stop_reason=${response.stop_reason})`;
    }
    break;
  }

  if (result.status === "failed" && result.handoff && !result.error) {
    // A transferência foi feita, mas o modelo não escreveu o aviso: usamos a mensagem padrão.
    result.reply = ctx.agent.handoffMessage;
    result.status = "succeeded";
  }
  if (result.status === "failed" && !result.error) result.error = "limite de iterações do agente atingido";
  result.latencyMs = Date.now() - started;
  return result;
}
