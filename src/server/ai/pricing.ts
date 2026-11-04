import type { SupportedModel } from "../domain";

/**
 * Preços da API da Anthropic em USD por milhão de tokens (tabela de 2026-10).
 * Escrita em cache de 5 min = 1,25× entrada. Confira a página oficial antes de
 * orçar: https://platform.claude.com/docs/en/about-claude/pricing
 */
interface RateCard {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

interface ModelPricing {
  standard: RateCard;
  /** Haiku 5.5 cobra outra tabela quando o prompt passa de 100 mil tokens. */
  longPrompt?: { thresholdTokens: number; rates: RateCard };
}

export const MODEL_PRICING: Record<SupportedModel, ModelPricing> = {
  "claude-haiku-5-5": {
    standard: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
    longPrompt: { thresholdTokens: 100_000, rates: { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 } },
  },
  "claude-sonnet-5-5": { standard: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 } },
  "claude-opus-5-5": { standard: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 } },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const emptyUsage = (): TokenUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Custo de UMA chamada em micro-dólares (1 USD = 1.000.000). */
export function costUsdMicros(model: SupportedModel, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model];
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const rates =
    pricing.longPrompt && promptTokens > pricing.longPrompt.thresholdTokens ? pricing.longPrompt.rates : pricing.standard;
  // tokens × (USD por 1M tokens) = micro-dólares
  return Math.ceil(
    usage.inputTokens * rates.input +
      usage.outputTokens * rates.output +
      usage.cacheWriteTokens * rates.cacheWrite +
      usage.cacheReadTokens * rates.cacheRead,
  );
}
