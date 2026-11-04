import Anthropic, { APIConnectionError, APIError, InternalServerError, RateLimitError } from "@anthropic-ai/sdk";

/**
 * Fronteira mínima com o provedor de IA. Usa os tipos oficiais do SDK;
 * existe para permitir testes determinísticos do pipeline (dublês em tests/).
 */
export interface LlmClient {
  createMessage(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    // Retentativas curtas aqui; falhas persistentes voltam para a fila com backoff.
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 45_000 });
  }

  createMessage(params: Anthropic.MessageCreateParamsNonStreaming) {
    return this.client.messages.create(params);
  }
}

/** Erros transitórios (limite de taxa, sobrecarga, rede) devem ser retentados pela fila. */
export function isRetryableLlmError(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof InternalServerError) return true;
  if (error instanceof APIConnectionError) return true; // inclui timeout
  if (error instanceof APIError) return error.status === 529 || error.status === 408 || error.status === 409;
  return false;
}
