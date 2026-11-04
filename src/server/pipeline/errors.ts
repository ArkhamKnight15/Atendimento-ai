import { APIError } from "@anthropic-ai/sdk";
import { isRetryableLlmError } from "../ai/llm";
import { WhatsAppApiError } from "../whatsapp/client";

/** Erro de configuração/dados que não se resolve com nova tentativa. */
export class PermanentError extends Error {
  override name = "PermanentError";
}

/** Erro transitório explícito (ex.: endpoint de webhook fora do ar). */
export class TransientError extends Error {
  override name = "TransientError";
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof PermanentError) return false;
  if (error instanceof TransientError) return true;
  if (error instanceof WhatsAppApiError) return error.retryable;
  // Erros da API de IA: 429/5xx/rede são transitórios; 400/401/403/404 não melhoram com retentativa.
  if (error instanceof APIError) return isRetryableLlmError(error);
  // Demais falhas (conexão com o banco, timeouts) são tratadas como transitórias.
  return true;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
