import type { Lead, LeadTemperature } from "../domain";
import type { Db } from "./client";

export async function getOpenLead(db: Db, tenantId: string, contactId: string): Promise<Lead | null> {
  const [lead] = await db<Lead[]>`
    select * from public.leads
    where tenant_id = ${tenantId} and contact_id = ${contactId} and stage not in ('won', 'lost')`;
  return lead ?? null;
}

export interface LeadInput {
  tenantId: string;
  contactId: string;
  conversationId: string;
  phone: string | null;
  name?: string | null;
  email?: string | null;
  interest?: string | null;
  notes?: string | null;
  temperature?: LeadTemperature | null;
  qualification?: { question: string; answer: string }[];
  at: Date;
}

/**
 * Cria ou atualiza o lead em aberto do contato. Campos vazios não apagam
 * dados já coletados; respostas de qualificação são mescladas por pergunta.
 */
export async function upsertOpenLead(db: Db, input: LeadInput): Promise<{ lead: Lead; created: boolean; becameHot: boolean }> {
  const existing = await getOpenLead(db, input.tenantId, input.contactId);
  const qualifies = input.temperature === "hot" || input.temperature === "warm";

  if (!existing) {
    const [lead] = await db<Lead[]>`
      insert into public.leads
        (tenant_id, contact_id, conversation_id, name, email, phone, interest, notes, temperature, qualification,
         stage, qualified_at)
      values
        (${input.tenantId}, ${input.contactId}, ${input.conversationId}, ${input.name ?? null}, ${input.email ?? null},
         ${input.phone}, ${input.interest ?? null}, ${input.notes ?? null}, ${input.temperature ?? null},
         ${db.json(input.qualification ?? [])}, ${qualifies ? "qualified" : "new"}, ${qualifies ? input.at : null})
      returning *`;
    return { lead: lead!, created: true, becameHot: input.temperature === "hot" };
  }

  const merged = new Map(existing.qualification.map((q) => [q.question, q.answer]));
  for (const item of input.qualification ?? []) merged.set(item.question, item.answer);
  const qualification = [...merged].map(([question, answer]) => ({ question, answer }));
  const notes = input.notes
    ? existing.notes && !existing.notes.includes(input.notes)
      ? `${existing.notes}\n${input.notes}`
      : input.notes
    : existing.notes;

  const [lead] = await db<Lead[]>`
    update public.leads set
      conversation_id = ${input.conversationId},
      name = coalesce(${input.name ?? null}, name),
      email = coalesce(${input.email ?? null}, email),
      interest = coalesce(${input.interest ?? null}, interest),
      notes = ${notes},
      temperature = coalesce(${input.temperature ?? null}, temperature),
      qualification = ${db.json(qualification)},
      stage = case when stage = 'new' and ${qualifies} then 'qualified' else stage end,
      qualified_at = case when qualified_at is null and ${qualifies} then ${input.at}::timestamptz else qualified_at end
    where id = ${existing.id} and tenant_id = ${input.tenantId}
    returning *`;
  return { lead: lead!, created: false, becameHot: input.temperature === "hot" && existing.temperature !== "hot" };
}
