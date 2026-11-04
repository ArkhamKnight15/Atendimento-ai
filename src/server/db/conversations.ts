import type { Contact, Conversation, Message, MessageSender, MessageStatus } from "../domain";
import type { Db } from "./client";

/** Após este período sem mensagens, um novo contato abre uma nova conversa. */
export const CONVERSATION_IDLE_HOURS = 24;

export async function upsertWhatsAppContact(
  db: Db,
  input: { tenantId: string; waId: string; profileName: string | null; at: Date },
): Promise<Contact> {
  const [contact] = await db<Contact[]>`
    insert into public.contacts (tenant_id, channel_type, external_id, phone, profile_name, last_inbound_at)
    values (${input.tenantId}, 'whatsapp', ${input.waId}, ${input.waId}, ${input.profileName}, ${input.at})
    on conflict (tenant_id, channel_type, external_id) do update set
      profile_name = coalesce(excluded.profile_name, public.contacts.profile_name),
      last_inbound_at = greatest(public.contacts.last_inbound_at, excluded.last_inbound_at)
    returning *`;
  return contact!;
}

/** Retorna a conversa ativa do contato ou abre uma nova (encerrando a anterior se ociosa). */
export async function getOrOpenConversation(
  db: Db,
  input: { tenantId: string; channelId: string; contactId: string; now: Date },
): Promise<{ conversation: Conversation; created: boolean }> {
  const [active] = await db<Conversation[]>`
    select * from public.conversations
    where tenant_id = ${input.tenantId} and channel_id = ${input.channelId}
      and contact_id = ${input.contactId} and status <> 'closed'
    for update`;

  if (active) {
    const idleMs = input.now.getTime() - active.lastMessageAt.getTime();
    if (idleMs < CONVERSATION_IDLE_HOURS * 3600_000) return { conversation: active, created: false };
    await db`
      update public.conversations set status = 'closed', closed_at = ${input.now}
      where id = ${active.id} and tenant_id = ${input.tenantId}`;
  }

  const [created] = await db<Conversation[]>`
    insert into public.conversations (tenant_id, channel_id, contact_id, last_message_at)
    values (${input.tenantId}, ${input.channelId}, ${input.contactId}, ${input.now})
    returning *`;
  return { conversation: created!, created: true };
}

export async function inboundExists(db: Db, tenantId: string, externalId: string): Promise<boolean> {
  const [row] = await db`
    select 1 from public.messages
    where tenant_id = ${tenantId} and direction = 'inbound' and external_id = ${externalId}`;
  return Boolean(row);
}

export async function insertInboundMessage(
  db: Db,
  input: {
    tenantId: string;
    conversationId: string;
    externalId: string;
    type: string;
    content: string;
    payload: unknown;
    createdAt: Date;
    needsReply: boolean;
  },
): Promise<Message | null> {
  const [message] = await db<Message[]>`
    insert into public.messages
      (tenant_id, conversation_id, direction, sender, type, content, payload, external_id, status, processed_at, created_at)
    values
      (${input.tenantId}, ${input.conversationId}, 'inbound', 'contact', ${input.type}, ${input.content},
       ${db.json(input.payload as never)}, ${input.externalId},
       ${input.needsReply ? "received" : "ignored"}, ${input.needsReply ? null : input.createdAt}, ${input.createdAt})
    on conflict (tenant_id, direction, external_id) where external_id is not null do nothing
    returning *`;
  if (!message) return null;

  await db`
    update public.conversations set
      last_inbound_at = greatest(last_inbound_at, ${input.createdAt}),
      last_message_at = greatest(last_message_at, ${input.createdAt})
    where id = ${input.conversationId} and tenant_id = ${input.tenantId}`;
  return message;
}

export async function getPendingInbound(db: Db, tenantId: string, conversationId: string): Promise<Message[]> {
  return db<Message[]>`
    select * from public.messages
    where tenant_id = ${tenantId} and conversation_id = ${conversationId}
      and direction = 'inbound' and processed_at is null
    order by created_at, seq`;
}

export async function markInboundProcessed(
  db: Db,
  input: { tenantId: string; ids: string[]; status: MessageStatus; agentRunId?: string | null; at: Date },
) {
  if (input.ids.length === 0) return;
  await db`
    update public.messages set processed_at = ${input.at}, status = ${input.status},
      agent_run_id = coalesce(${input.agentRunId ?? null}::uuid, agent_run_id)
    where tenant_id = ${input.tenantId} and id in ${db(input.ids)}`;
}

export interface HistoryItem {
  sender: MessageSender;
  content: string;
}

/** Últimas mensagens (já processadas) da conversa, da mais antiga para a mais recente. */
export async function getHistory(
  db: Db,
  input: { tenantId: string; conversationId: string; limit: number; excludeIds: string[] },
): Promise<HistoryItem[]> {
  const exclude = input.excludeIds.length ? input.excludeIds : ["00000000-0000-0000-0000-000000000000"];
  const rows = await db<HistoryItem[]>`
    select sender, content from (
      select sender, content, created_at, seq from public.messages
      where tenant_id = ${input.tenantId} and conversation_id = ${input.conversationId}
        and content is not null and status not in ('ignored', 'failed')
        and id not in ${db(exclude)}
      order by created_at desc, seq desc
      limit ${input.limit}
    ) recent
    order by created_at, seq`;
  return rows;
}

export async function countRecentInbound(db: Db, tenantId: string, contactId: string, sinceMs: number, now: Date) {
  const [row] = await db<{ count: number }[]>`
    select count(*)::int as count from public.messages m
    join public.conversations c on c.id = m.conversation_id and c.tenant_id = m.tenant_id
    where m.tenant_id = ${tenantId} and c.contact_id = ${contactId}
      and m.direction = 'inbound' and m.created_at > ${new Date(now.getTime() - sinceMs)}`;
  return row?.count ?? 0;
}

export async function insertOutboundMessages(
  db: Db,
  input: { tenantId: string; conversationId: string; sender: MessageSender; parts: string[]; agentRunId: string | null; at: Date },
): Promise<Message[]> {
  const created: Message[] = [];
  for (const [index, part] of input.parts.entries()) {
    const [message] = await db<Message[]>`
      insert into public.messages
        (tenant_id, conversation_id, direction, sender, type, content, status, agent_run_id, created_at)
      values (${input.tenantId}, ${input.conversationId}, 'outbound', ${input.sender}, 'text', ${part},
              'pending', ${input.agentRunId}, ${new Date(input.at.getTime() + index)})
      returning *`;
    created.push(message!);
  }
  await db`
    update public.conversations set last_message_at = greatest(last_message_at, ${input.at})
    where id = ${input.conversationId} and tenant_id = ${input.tenantId}`;
  return created;
}

export async function getPendingOutbound(db: Db, tenantId: string, conversationId: string): Promise<Message[]> {
  return db<Message[]>`
    select * from public.messages
    where tenant_id = ${tenantId} and conversation_id = ${conversationId}
      and direction = 'outbound' and status = 'pending'
    order by created_at, seq`;
}

export async function markOutboundSent(db: Db, input: { tenantId: string; id: string; externalId: string; at: Date }) {
  await db`
    update public.messages set status = 'sent', external_id = ${input.externalId}, sent_at = ${input.at}
    where tenant_id = ${input.tenantId} and id = ${input.id}`;
}

export async function markOutboundFailed(
  db: Db,
  input: { tenantId: string; id: string; errorCode: string | null; errorMessage: string },
) {
  await db`
    update public.messages set status = 'failed', error_code = ${input.errorCode}, error_message = ${input.errorMessage}
    where tenant_id = ${input.tenantId} and id = ${input.id}`;
}

/** Atualiza status de entrega vindo do webhook. Nunca regride (read não volta para delivered). */
export async function applyDeliveryStatus(
  db: Db,
  input: { channelId: string; externalId: string; status: "sent" | "delivered" | "read" | "failed"; at: Date; errorCode: string | null; errorMessage: string | null },
) {
  const rank = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 } as const;
  await db`
    update public.messages m set
      status = ${input.status},
      delivered_at = case when ${input.status} in ('delivered', 'read') then coalesce(m.delivered_at, ${input.at}) else m.delivered_at end,
      read_at = case when ${input.status} = 'read' then ${input.at} else m.read_at end,
      error_code = coalesce(${input.errorCode}, m.error_code),
      error_message = coalesce(${input.errorMessage}, m.error_message)
    from public.conversations c
    where m.direction = 'outbound' and m.external_id = ${input.externalId}
      and c.id = m.conversation_id and c.tenant_id = m.tenant_id and c.channel_id = ${input.channelId}
      and (case m.status when 'pending' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 4 end)
          < ${rank[input.status]}`;
}

export async function setConversationHandoff(
  db: Db,
  input: { tenantId: string; conversationId: string; reason: string; summary: string; at: Date; until: Date },
) {
  await db`
    update public.conversations set status = 'human', handoff_reason = ${input.reason},
      handoff_summary = ${input.summary}, handoff_at = ${input.at}, handoff_until = ${input.until}
    where id = ${input.conversationId} and tenant_id = ${input.tenantId}`;
}

export async function resumeConversationBot(db: Db, tenantId: string, conversationId: string) {
  await db`
    update public.conversations set status = 'open', handoff_until = null
    where id = ${conversationId} and tenant_id = ${tenantId} and status = 'human'`;
}

export async function updateContactProfile(
  db: Db,
  input: { tenantId: string; contactId: string; name?: string | null; email?: string | null },
) {
  await db`
    update public.contacts set
      name = coalesce(${input.name ?? null}, name),
      email = coalesce(${input.email ?? null}, email)
    where id = ${input.contactId} and tenant_id = ${input.tenantId}`;
}

export async function setMarketingOptOut(db: Db, tenantId: string, contactId: string, at: Date | null) {
  await db`
    update public.contacts set marketing_opt_out_at = ${at}
    where id = ${contactId} and tenant_id = ${tenantId}`;
}

export async function markPrivacyNoticeSent(db: Db, tenantId: string, contactId: string, at: Date) {
  await db`
    update public.contacts set privacy_notice_sent_at = coalesce(privacy_notice_sent_at, ${at})
    where id = ${contactId} and tenant_id = ${tenantId}`;
}
