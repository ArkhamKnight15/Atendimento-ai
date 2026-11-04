import { buildCompanyKnowledge, KNOWLEDGE_MAX_CHARS } from "../ai/prompt";
import type { Sql } from "../db/client";
import { loadKnowledge } from "../db/context";
import type { Agent, Tenant } from "../domain";
import type { TenantConfig } from "./schema";

export interface ApplyResult {
  tenantId: string;
  agentId: string;
  tenantCreated: boolean;
  knowledgeChars: number;
  counts: { catalog: number; faqs: number; knowledge: number; businessHours: number };
}

function assertTimezone(timeZone: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions();
  } catch {
    throw new Error(`Fuso horário inválido: ${timeZone}`);
  }
}

/**
 * Sincroniza a configuração de uma empresa de forma idempotente, em uma única
 * transação: cria ou atualiza empresa e agente, e substitui catálogo, FAQs,
 * base de conhecimento e horários pelo conteúdo do arquivo.
 */
export async function applyTenantConfig(sql: Sql, config: TenantConfig): Promise<ApplyResult> {
  assertTimezone(config.timezone);

  return sql.begin(async (tx) => {
    const [plan] = await tx<{ id: string }[]>`select id from public.plans where code = ${config.plan} and is_active`;
    if (!plan) throw new Error(`Plano "${config.plan}" não existe ou está inativo.`);

    const c = config.contact;
    const [tenant] = await tx<(Tenant & { inserted: boolean })[]>`
      insert into public.tenants
        (slug, name, segment, description, status, plan_id, limits_override, timezone, address, city, state,
         maps_url, website, contact_phone, contact_email, privacy_policy_url)
      values
        (${config.slug}, ${config.name}, ${config.segment ?? null}, ${config.description ?? null}, ${config.status},
         ${plan.id}, ${tx.json(config.limitsOverride)}, ${config.timezone}, ${c.address ?? null}, ${c.city ?? null},
         ${c.state ?? null}, ${c.mapsUrl ?? null}, ${c.website ?? null}, ${c.phone ?? null}, ${c.email ?? null},
         ${config.privacyPolicyUrl ?? null})
      on conflict (slug) do update set
        name = excluded.name, segment = excluded.segment, description = excluded.description,
        status = excluded.status, plan_id = excluded.plan_id, limits_override = excluded.limits_override,
        timezone = excluded.timezone, address = excluded.address, city = excluded.city, state = excluded.state,
        maps_url = excluded.maps_url, website = excluded.website, contact_phone = excluded.contact_phone,
        contact_email = excluded.contact_email, privacy_policy_url = excluded.privacy_policy_url
      returning *, (xmax = 0) as inserted`;
    const tenantId = tenant!.id;

    const a = config.agent;
    const agentFields = {
      name: a.name,
      isActive: a.active,
      tone: a.tone,
      greeting: a.greeting ?? null,
      instructions: a.instructions ?? null,
      businessRules: a.businessRules,
      allowedInfo: a.allowedInfo,
      restrictedInfo: a.restrictedInfo,
      handoffTriggers: a.handoffTriggers,
      qualificationQuestions: a.qualificationQuestions,
      handoffMessage: a.handoffMessage,
      fallbackMessage: a.fallbackMessage,
      aiModel: a.aiModel ?? null,
      aiEffort: a.aiEffort ?? null,
      maxReplyChars: a.maxReplyChars,
      handoffTimeoutMinutes: a.handoffTimeoutMinutes,
    };
    const columns = Object.keys(agentFields) as (keyof typeof agentFields)[];
    const [existingAgent] = await tx<{ id: string }[]>`
      select id from public.agents where tenant_id = ${tenantId} order by created_at limit 1`;
    const [agent] = existingAgent
      ? await tx<Agent[]>`
          update public.agents set ${tx(agentFields, columns)}
          where id = ${existingAgent.id} and tenant_id = ${tenantId} returning *`
      : await tx<Agent[]>`
          insert into public.agents ${tx({ ...agentFields, tenantId })} returning *`;

    // Catálogo: upsert por nome (preserva vínculos de leads) e remoção do que saiu do arquivo.
    const catalogNames = config.catalog.map((item) => item.name);
    for (const [index, item] of config.catalog.entries()) {
      const priceCents = item.priceType === "on_request" || item.price === undefined ? null : Math.round(item.price * 100);
      await tx`
        insert into public.catalog_items
          (tenant_id, kind, name, description, price_type, price_cents, duration_minutes, is_active, sort_order)
        values (${tenantId}, ${item.kind}, ${item.name}, ${item.description ?? null}, ${item.priceType}, ${priceCents},
                ${item.durationMinutes ?? null}, ${item.active}, ${index})
        on conflict (tenant_id, name) do update set
          kind = excluded.kind, description = excluded.description, price_type = excluded.price_type,
          price_cents = excluded.price_cents, duration_minutes = excluded.duration_minutes,
          is_active = excluded.is_active, sort_order = excluded.sort_order`;
    }
    await tx`
      delete from public.catalog_items where tenant_id = ${tenantId}
      and ${catalogNames.length ? tx`name not in ${tx(catalogNames)}` : tx`true`}`;

    await tx`delete from public.faqs where tenant_id = ${tenantId}`;
    for (const [index, faq] of config.faqs.entries()) {
      await tx`
        insert into public.faqs (tenant_id, question, answer, sort_order)
        values (${tenantId}, ${faq.question}, ${faq.answer}, ${index})`;
    }

    await tx`delete from public.knowledge_entries where tenant_id = ${tenantId}`;
    for (const [index, entry] of config.knowledge.entries()) {
      await tx`
        insert into public.knowledge_entries (tenant_id, title, content, sort_order)
        values (${tenantId}, ${entry.title}, ${entry.content}, ${index})`;
    }

    await tx`delete from public.business_hours where tenant_id = ${tenantId}`;
    let hoursCount = 0;
    for (const interval of config.businessHours) {
      for (const weekday of interval.days) {
        await tx`
          insert into public.business_hours (tenant_id, weekday, opens_at, closes_at)
          values (${tenantId}, ${weekday}, ${interval.opensAt}, ${interval.closesAt})`;
        hoursCount += 1;
      }
    }

    // O conteúdo inteiro vai para o prompt em cache: garante que cabe com folga.
    const knowledge = await loadKnowledge(tx, tenantId);
    const rendered = buildCompanyKnowledge({ tenant: tenant!, agent: agent!, knowledge });
    if (rendered.length > KNOWLEDGE_MAX_CHARS) {
      throw new Error(
        `Base de conhecimento com ${rendered.length} caracteres excede o limite de ${KNOWLEDGE_MAX_CHARS}. Resuma o conteúdo.`,
      );
    }

    return {
      tenantId,
      agentId: agent!.id,
      tenantCreated: tenant!.inserted,
      knowledgeChars: rendered.length,
      counts: {
        catalog: config.catalog.length,
        faqs: config.faqs.length,
        knowledge: config.knowledge.length,
        businessHours: hoursCount,
      },
    };
  });
}
