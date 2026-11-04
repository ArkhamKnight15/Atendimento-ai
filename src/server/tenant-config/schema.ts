import { z } from "zod";
import { SUPPORTED_MODELS } from "../domain";

/**
 * Formato do arquivo de configuração de uma empresa (tenants/<slug>.json).
 * É a forma rápida de cadastrar um cliente até o painel (Fase 3) existir —
 * e continuará útil para versionar e replicar configurações.
 */
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM (24h)");
const text = (max: number) => z.string().trim().min(1).max(max);

const businessHoursSchema = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).min(1),
    opensAt: time,
    closesAt: time,
  })
  .refine((h) => h.closesAt > h.opensAt, "closesAt deve ser depois de opensAt");

const catalogItemSchema = z
  .object({
    kind: z.enum(["service", "product"]).default("service"),
    name: text(120),
    description: text(2000).optional(),
    priceType: z.enum(["fixed", "starting_at", "on_request"]).default("fixed"),
    /** Valor em reais (ex.: 250 ou 199.9). */
    price: z.number().nonnegative().optional(),
    durationMinutes: z.number().int().positive().optional(),
    active: z.boolean().default(true),
  })
  .refine((item) => item.priceType === "on_request" || item.price !== undefined, {
    message: "informe price, ou use priceType = on_request",
  });

export const tenantConfigSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use letras minúsculas, números e hífens"),
  name: text(120),
  segment: text(120).optional(),
  description: text(4000).optional(),
  status: z.enum(["onboarding", "active", "suspended", "canceled"]).default("onboarding"),
  plan: z.string().min(1),
  timezone: z.string().default("America/Sao_Paulo"),
  privacyPolicyUrl: z.url({ protocol: /^https$/ }).optional(),
  limitsOverride: z
    .object({
      monthlyAiReplies: z.number().int().positive().optional(),
      monthlyAiBudgetUsdMicros: z.number().int().positive().optional(),
    })
    .default({}),
  contact: z
    .object({
      address: text(300).optional(),
      city: text(120).optional(),
      state: text(60).optional(),
      mapsUrl: z.url().optional(),
      website: z.url().optional(),
      phone: text(40).optional(),
      email: z.email().optional(),
    })
    .default({}),
  agent: z.object({
    name: text(60),
    tone: text(500),
    greeting: text(500).optional(),
    instructions: text(4000).optional(),
    businessRules: z.array(text(500)).default([]),
    allowedInfo: z.array(text(500)).default([]),
    restrictedInfo: z.array(text(500)).default([]),
    handoffTriggers: z.array(text(300)).default([]),
    qualificationQuestions: z.array(text(300)).default([]),
    handoffMessage: text(600),
    fallbackMessage: text(600),
    aiModel: z.enum(SUPPORTED_MODELS).optional(),
    aiEffort: z.enum(["low", "medium", "high"]).optional(),
    maxReplyChars: z.number().int().min(200).max(3000).default(700),
    handoffTimeoutMinutes: z.number().int().min(15).max(10080).default(720),
    active: z.boolean().default(true),
  }),
  businessHours: z.array(businessHoursSchema).default([]),
  catalog: z.array(catalogItemSchema).default([]),
  faqs: z.array(z.object({ question: text(500), answer: text(3000) })).default([]),
  knowledge: z.array(z.object({ title: text(200), content: text(20000) })).default([]),
});

export type TenantConfig = z.infer<typeof tenantConfigSchema>;

export function parseTenantConfig(input: unknown): TenantConfig {
  const result = tenantConfigSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(raiz)"}: ${i.message}`).join("\n");
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  const names = new Set<string>();
  for (const item of result.data.catalog) {
    if (names.has(item.name)) throw new Error(`Configuração inválida: item de catálogo duplicado "${item.name}"`);
    names.add(item.name);
  }
  return result.data;
}
