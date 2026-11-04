import type { Sql } from "../../src/server/db/client";
import { applyTenantConfig } from "../../src/server/tenant-config/apply";
import { connectWhatsAppChannel } from "../../src/server/tenant-config/channels";
import { parseTenantConfig } from "../../src/server/tenant-config/schema";
import { addWebhookEndpoint } from "../../src/server/tenant-config/webhooks";

export interface TenantFixture {
  tenantId: string;
  channelId: string;
  phoneNumberId: string;
  webhookSecret: string;
}

export async function createTenant(
  sql: Sql,
  input: { slug: string; phoneNumberId: string; encryptionKey: string; plan?: string; privacyPolicyUrl?: string },
): Promise<TenantFixture> {
  const config = parseTenantConfig({
    slug: input.slug,
    name: `Empresa ${input.slug}`,
    plan: input.plan ?? "profissional",
    status: "active",
    privacyPolicyUrl: input.privacyPolicyUrl,
    agent: {
      name: "Bia",
      tone: "simpático e objetivo",
      handoffMessage: "Vou chamar alguém da equipe para continuar com você.",
      fallbackMessage: "Tive uma instabilidade. Nossa equipe vai continuar o atendimento.",
      qualificationQuestions: ["Para quando precisa?"],
    },
    businessHours: [{ days: [0, 1, 2, 3, 4, 5, 6], opensAt: "00:00", closesAt: "23:59" }],
    catalog: [
      { name: "Corte de cabelo", price: 60, durationMinutes: 40 },
      { name: "Coloração", priceType: "starting_at", price: 150 },
    ],
    faqs: [{ question: "Aceitam Pix?", answer: "Sim, aceitamos Pix e cartões." }],
  });
  const { tenantId } = await applyTenantConfig(sql, config);
  const { channelId } = await connectWhatsAppChannel(sql, {
    tenantSlug: input.slug,
    phoneNumberId: input.phoneNumberId,
    wabaId: null,
    displayPhoneNumber: null,
    name: "WhatsApp",
    accessToken: `token-${input.slug}`,
    encryptionKey: input.encryptionKey,
  });
  const { secret } = await addWebhookEndpoint(sql, {
    tenantSlug: input.slug,
    name: "n8n",
    url: `https://n8n.example.com/webhook/${input.slug}`,
    events: ["lead.created", "lead.hot", "conversation.handoff_requested", "contact.opted_out", "usage.limit_reached"],
    encryptionKey: input.encryptionKey,
  });
  return { tenantId, channelId, phoneNumberId: input.phoneNumberId, webhookSecret: secret };
}
