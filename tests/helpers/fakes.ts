import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient } from "../../src/server/ai/llm";
import type { Sql } from "../../src/server/db/client";
import type { Logger } from "../../src/server/lib/logger";
import type { Deps } from "../../src/server/pipeline/deps";
import type { WhatsAppClient, WhatsAppCredentials } from "../../src/server/whatsapp/client";

/** Dublês de teste: respostas roteirizadas da IA e envio do WhatsApp em memória. */
type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export function llmMessage(
  content: Block[],
  stopReason: Anthropic.StopReason,
  usage: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number }> = {},
): Anthropic.Message {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: stopReason === "refusal" ? { type: "refusal", category: null, explanation: null } : null,
    usage: {
      input_tokens: usage.input ?? 300,
      output_tokens: usage.output ?? 80,
      cache_read_input_tokens: usage.cacheRead ?? 2500,
      cache_creation_input_tokens: usage.cacheWrite ?? 0,
    },
  } as unknown as Anthropic.Message;
}

export const text = (value: string) => llmMessage([{ type: "text", text: value }], "end_turn");
export const toolUse = (name: string, input: Record<string, unknown>, id = `toolu_${name}`) =>
  llmMessage([{ type: "tool_use", id, name, input }], "tool_use");

export class FakeLlm implements LlmClient {
  readonly calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  private readonly script: (Anthropic.Message | Error)[] = [];

  enqueue(...responses: (Anthropic.Message | Error)[]) {
    this.script.push(...responses);
    return this;
  }

  async createMessage(params: Anthropic.MessageCreateParamsNonStreaming) {
    this.calls.push(structuredClone(params));
    const next = this.script.shift();
    if (!next) throw new Error("FakeLlm: nenhuma resposta roteirizada");
    if (next instanceof Error) throw next;
    return next;
  }
}

export class FakeWhatsApp implements WhatsAppClient {
  readonly sent: { credentials: WhatsAppCredentials; to: string; body: string; externalId: string }[] = [];
  readonly read: string[] = [];
  failNext: Error | null = null;

  async sendText(credentials: WhatsAppCredentials, to: string, body: string) {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    const externalId = `wamid.out.${randomUUID()}`;
    this.sent.push({ credentials, to, body, externalId });
    return { externalId };
  }

  async markAsRead(_credentials: WhatsAppCredentials, id: string) {
    this.read.push(id);
  }
}

/** Logger que guarda avisos e erros para os testes verificarem falhas silenciosas. */
export function capturingLogger(problems: string[]): Logger {
  const record = (level: string) => (message: string, fields?: Record<string, unknown>) =>
    problems.push(`${level}: ${message} ${fields ? JSON.stringify(fields) : ""}`);
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: record("warn"),
    error: record("error"),
    child: () => logger,
  };
  return logger;
}

export interface TestDeps extends Deps {
  llm: FakeLlm;
  whatsapp: FakeWhatsApp;
  fetchCalls: { url: string; init: RequestInit }[];
  problems: string[];
}

export function createTestDeps(sql: Sql, options: { encryptionKey: string; fetchStatus?: number }): TestDeps {
  const fetchCalls: { url: string; init: RequestInit }[] = [];
  const problems: string[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init: init ?? {} });
    return new Response("ok", { status: options.fetchStatus ?? 200 });
  }) as typeof fetch;
  return {
    sql,
    llm: new FakeLlm(),
    whatsapp: new FakeWhatsApp(),
    logger: capturingLogger(problems),
    now: () => new Date(),
    encryptionKey: options.encryptionKey,
    debounceMs: 0,
    fetch: fakeFetch,
    sleep: async () => {},
    fetchCalls,
    problems,
  };
}
