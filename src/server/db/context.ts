import type {
  Agent,
  AgentContext,
  CatalogItem,
  Channel,
  ChannelType,
  Contact,
  Conversation,
  Faq,
  KnowledgeEntry,
  Plan,
  Tenant,
} from "../domain";
import type { BusinessHoursInterval } from "../lib/business-hours";
import type { Db } from "./client";
import { getOpenLead } from "./leads";

export async function findChannelByExternalId(db: Db, type: ChannelType, externalId: string): Promise<Channel | null> {
  const [channel] = await db<Channel[]>`
    select * from public.channels where type = ${type} and external_id = ${externalId}`;
  return channel ?? null;
}

export async function touchChannelInbound(db: Db, channelId: string, at: Date) {
  await db`
    update public.channels set last_inbound_at = greatest(last_inbound_at, ${at}) where id = ${channelId}`;
}

export async function recordChannelError(db: Db, channelId: string, error: string, at: Date, markAsError: boolean) {
  await db`
    update public.channels set last_error = ${error}, last_error_at = ${at},
      status = case when ${markAsError} then 'error' else status end
    where id = ${channelId}`;
}

export async function getChannelAccessTokenEnc(db: Db, channelId: string): Promise<string | null> {
  const [row] = await db<{ accessTokenEnc: string }[]>`
    select access_token_enc from private.channel_credentials where channel_id = ${channelId}`;
  return row?.accessTokenEnc ?? null;
}

export async function loadKnowledge(db: Db, tenantId: string): Promise<AgentContext["knowledge"]> {
  const [catalog, faqs, entries, hours] = await Promise.all([
    db<CatalogItem[]>`
      select id, kind, name, description, price_type, price_cents, duration_minutes
      from public.catalog_items where tenant_id = ${tenantId} and is_active
      order by sort_order, name`,
    db<Faq[]>`
      select question, answer from public.faqs where tenant_id = ${tenantId} and is_active
      order by sort_order, question`,
    db<KnowledgeEntry[]>`
      select title, content from public.knowledge_entries where tenant_id = ${tenantId} and is_active
      order by sort_order, title`,
    db<BusinessHoursInterval[]>`
      select weekday, to_char(opens_at, 'HH24:MI') as opens_at, to_char(closes_at, 'HH24:MI') as closes_at
      from public.business_hours where tenant_id = ${tenantId}
      order by weekday, opens_at`,
  ]);
  return { catalog, faqs, entries, hours };
}

/** Carrega, em poucas consultas, tudo que o agente precisa para responder a conversa. */
export async function loadAgentContext(db: Db, tenantId: string, conversationId: string): Promise<AgentContext | null> {
  const [conversation] = await db<Conversation[]>`
    select * from public.conversations where id = ${conversationId} and tenant_id = ${tenantId}`;
  if (!conversation) return null;

  const [[tenant], [channel], [contact]] = await Promise.all([
    db<Tenant[]>`select * from public.tenants where id = ${tenantId}`,
    db<Channel[]>`select * from public.channels where id = ${conversation.channelId} and tenant_id = ${tenantId}`,
    db<Contact[]>`select * from public.contacts where id = ${conversation.contactId} and tenant_id = ${tenantId}`,
  ]);
  if (!tenant || !channel || !contact) return null;

  const [[plan], [agent], knowledge, lead] = await Promise.all([
    db<Plan[]>`select * from public.plans where id = ${tenant.planId}`,
    db<Agent[]>`select * from public.agents where id = ${channel.agentId} and tenant_id = ${tenantId}`,
    loadKnowledge(db, tenantId),
    getOpenLead(db, tenantId, contact.id),
  ]);
  if (!plan || !agent) return null;

  return { tenant, plan, agent, channel, contact, conversation, knowledge, lead };
}
