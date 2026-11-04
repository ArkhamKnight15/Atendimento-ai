import { AnthropicLlmClient, type LlmClient } from "../ai/llm";
import { getSql, type Sql } from "../db/client";
import { getEnv } from "../env";
import { logger, type Logger } from "../lib/logger";
import { GraphWhatsAppClient, type WhatsAppClient } from "../whatsapp/client";

/** Dependências injetáveis do pipeline (permite testes com dublês). */
export interface Deps {
  sql: Sql;
  llm: LlmClient;
  whatsapp: WhatsAppClient;
  logger: Logger;
  now: () => Date;
  encryptionKey: string;
  debounceMs: number;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

let deps: Deps | undefined;

export function getDeps(): Deps {
  if (deps) return deps;
  const env = getEnv();
  deps = {
    sql: getSql(env.DATABASE_URL),
    llm: new AnthropicLlmClient(env.ANTHROPIC_API_KEY),
    whatsapp: new GraphWhatsAppClient(env.WHATSAPP_GRAPH_API_VERSION),
    logger,
    now: () => new Date(),
    encryptionKey: env.CREDENTIALS_ENCRYPTION_KEY,
    debounceMs: env.REPLY_DEBOUNCE_MS,
    fetch,
    sleep,
  };
  return deps;
}
