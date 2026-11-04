import type { TokenUsage } from "../ai/pricing";
import type { Db } from "./client";

export interface MonthlyUsage {
  aiReplies: number;
  costUsdMicros: number;
  limitWarningAt: Date | null;
  limitReachedAt: Date | null;
  budgetExhaustedAt: Date | null;
}

/** Primeiro dia do mês corrente no fuso da empresa (AAAA-MM-01). */
export function usagePeriod(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}-01`;
}

export async function getMonthlyUsage(db: Db, tenantId: string, period: string): Promise<MonthlyUsage> {
  const [row] = await db<MonthlyUsage[]>`
    select ai_replies, cost_usd_micros, limit_warning_at, limit_reached_at, budget_exhausted_at
    from public.usage_monthly where tenant_id = ${tenantId} and period = ${period}`;
  return row ?? { aiReplies: 0, costUsdMicros: 0, limitWarningAt: null, limitReachedAt: null, budgetExhaustedAt: null };
}

export interface UsageIncrement {
  aiReplies?: number;
  inboundMessages?: number;
  outboundMessages?: number;
  tokens?: TokenUsage;
  costUsdMicros?: number;
  leadsCreated?: number;
  handoffs?: number;
}

export async function incrementUsage(db: Db, tenantId: string, period: string, inc: UsageIncrement) {
  const t = inc.tokens;
  await db`
    insert into public.usage_monthly as u (
      tenant_id, period, ai_replies, inbound_messages, outbound_messages, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, cost_usd_micros, leads_created, handoffs)
    values (
      ${tenantId}, ${period}, ${inc.aiReplies ?? 0}, ${inc.inboundMessages ?? 0}, ${inc.outboundMessages ?? 0},
      ${t?.inputTokens ?? 0}, ${t?.outputTokens ?? 0}, ${t?.cacheReadTokens ?? 0}, ${t?.cacheWriteTokens ?? 0},
      ${inc.costUsdMicros ?? 0}, ${inc.leadsCreated ?? 0}, ${inc.handoffs ?? 0})
    on conflict (tenant_id, period) do update set
      ai_replies = u.ai_replies + excluded.ai_replies,
      inbound_messages = u.inbound_messages + excluded.inbound_messages,
      outbound_messages = u.outbound_messages + excluded.outbound_messages,
      input_tokens = u.input_tokens + excluded.input_tokens,
      output_tokens = u.output_tokens + excluded.output_tokens,
      cache_read_tokens = u.cache_read_tokens + excluded.cache_read_tokens,
      cache_write_tokens = u.cache_write_tokens + excluded.cache_write_tokens,
      cost_usd_micros = u.cost_usd_micros + excluded.cost_usd_micros,
      leads_created = u.leads_created + excluded.leads_created,
      handoffs = u.handoffs + excluded.handoffs`;
}

const THRESHOLD_COLUMN = {
  warning: "limit_warning_at",
  reached: "limit_reached_at",
  budget: "budget_exhausted_at",
} as const;

/** Marca cada marco de consumo apenas uma vez por mês. Retorna true se marcou agora. */
export async function flagUsageThreshold(
  db: Db,
  tenantId: string,
  period: string,
  kind: keyof typeof THRESHOLD_COLUMN,
  at: Date,
): Promise<boolean> {
  const column = db(THRESHOLD_COLUMN[kind]);
  const rows = await db`
    update public.usage_monthly set ${column} = ${at}
    where tenant_id = ${tenantId} and period = ${period} and ${column} is null returning 1`;
  return rows.length > 0;
}
