import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Db } from "../db/client";
import { setConversationHandoff, updateContactProfile } from "../db/conversations";
import { emitEvent } from "../db/events";
import { upsertOpenLead } from "../db/leads";
import { incrementUsage, usagePeriod } from "../db/usage";
import type { AgentContext } from "../domain";
import { hasFeature } from "../domain";
import { describeOpenStatus, getOpenStatus } from "../lib/business-hours";

/**
 * Ferramentas do agente. O escopo (empresa, contato, conversa) vem SEMPRE do
 * contexto do servidor, nunca dos argumentos do modelo: mesmo uma mensagem
 * maliciosa não consegue ler ou gravar dados de outra empresa.
 */
export interface ToolRuntime {
  db: Db;
  ctx: AgentContext;
  now: Date;
}

export interface ToolOutcome {
  /** Texto devolvido ao modelo como tool_result. */
  result: string;
  isError?: boolean;
  handoff?: { reason: string; summary: string };
}

const HANDOFF_REASONS = [
  "customer_request",
  "complaint",
  "purchase_intent",
  "missing_information",
  "sensitive_topic",
  "other",
] as const;

const saveLeadSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.email().max(200).optional(),
  interest: z.string().trim().min(1).max(300).optional(),
  notes: z.string().trim().min(1).max(1000).optional(),
  temperature: z.enum(["cold", "warm", "hot"]).optional(),
  qualification: z
    .array(z.object({ question: z.string().trim().min(1).max(200), answer: z.string().trim().min(1).max(500) }))
    .max(20)
    .optional(),
});

const transferSchema = z.object({
  reason: z.enum(HANDOFF_REASONS),
  summary: z.string().trim().min(5).max(1500),
});

export function buildTools(ctx: AgentContext): Anthropic.Tool[] {
  const qualification = hasFeature(ctx.plan, "leadQualification");

  const leadProperties: Record<string, unknown> = {
    name: { type: "string", description: "Nome do cliente, como ele se apresentou." },
    email: { type: "string", description: "E-mail informado pelo cliente." },
    interest: { type: "string", description: "Serviço ou produto de interesse, com o nome do catálogo quando houver." },
    notes: { type: "string", description: "Detalhes úteis para a equipe comercial (prazo, preferência de horário, contexto)." },
  };
  if (qualification) {
    leadProperties.temperature = {
      type: "string",
      enum: ["cold", "warm", "hot"],
      description: "cold = só pesquisando; warm = interesse claro sem urgência; hot = quer contratar/agendar agora.",
    };
    leadProperties.qualification = {
      type: "array",
      description: "Respostas do cliente às perguntas de qualificação.",
      items: {
        type: "object",
        properties: { question: { type: "string" }, answer: { type: "string" } },
        required: ["question", "answer"],
        additionalProperties: false,
      },
    };
  }

  return [
    {
      name: "save_lead",
      description:
        "Registra ou atualiza o cliente como oportunidade comercial. Use assim que o cliente informar nome, interesse ou outro dado comercial relevante. Envie só os campos novos ou alterados.",
      strict: true,
      input_schema: { type: "object", properties: leadProperties, required: [], additionalProperties: false },
    },
    {
      name: "transfer_to_human",
      description:
        "Transfere a conversa para um atendente humano e pausa as respostas automáticas. Use nos casos previstos nas instruções. Depois, avise o cliente sobre a transferência.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          reason: { type: "string", enum: [...HANDOFF_REASONS], description: "Motivo principal da transferência." },
          summary: {
            type: "string",
            description: "Resumo objetivo para o atendente: quem é o cliente, o que quer e o que já foi respondido.",
          },
        },
        required: ["reason", "summary"],
        additionalProperties: false,
      },
    },
  ];
}

function waLink(phone: string | null): string | null {
  return phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : null;
}

async function saveLead(runtime: ToolRuntime, input: unknown): Promise<ToolOutcome> {
  const parsed = saveLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { result: `Dados inválidos: ${parsed.error.issues.map((i) => i.message).join("; ")}`, isError: true };
  }
  const { db, ctx, now } = runtime;
  const data = parsed.data;
  const qualificationEnabled = hasFeature(ctx.plan, "leadQualification");

  const { lead, created, becameHot } = await upsertOpenLead(db, {
    tenantId: ctx.tenant.id,
    contactId: ctx.contact.id,
    conversationId: ctx.conversation.id,
    phone: ctx.contact.phone,
    name: data.name,
    email: data.email,
    interest: data.interest,
    notes: data.notes,
    temperature: qualificationEnabled ? data.temperature : undefined,
    qualification: qualificationEnabled ? data.qualification : undefined,
    at: now,
  });
  await updateContactProfile(db, { tenantId: ctx.tenant.id, contactId: ctx.contact.id, name: data.name, email: data.email });
  ctx.lead = lead;

  const payload = {
    lead: {
      id: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      interest: lead.interest,
      notes: lead.notes,
      temperature: lead.temperature,
      qualification: lead.qualification,
      stage: lead.stage,
    },
    conversationId: ctx.conversation.id,
    whatsappLink: waLink(lead.phone),
  };
  await emitEvent(db, { tenantId: ctx.tenant.id, type: created ? "lead.created" : "lead.updated", payload, at: now });
  if (becameHot) {
    await emitEvent(db, { tenantId: ctx.tenant.id, type: "lead.hot", payload, dedupeKey: `lead.hot:${lead.id}`, at: now });
  }
  if (created) await incrementUsage(db, ctx.tenant.id, usagePeriod(now, ctx.tenant.timezone), { leadsCreated: 1 });

  return { result: created ? "Lead registrado." : "Lead atualizado." };
}

async function transferToHuman(runtime: ToolRuntime, input: unknown): Promise<ToolOutcome> {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) {
    return { result: `Dados inválidos: ${parsed.error.issues.map((i) => i.message).join("; ")}`, isError: true };
  }
  const { db, ctx, now } = runtime;
  const until = new Date(now.getTime() + ctx.agent.handoffTimeoutMinutes * 60_000);
  await setConversationHandoff(db, {
    tenantId: ctx.tenant.id,
    conversationId: ctx.conversation.id,
    reason: parsed.data.reason,
    summary: parsed.data.summary,
    at: now,
    until,
  });
  ctx.conversation.status = "human";

  await emitEvent(db, {
    tenantId: ctx.tenant.id,
    type: "conversation.handoff_requested",
    payload: {
      conversationId: ctx.conversation.id,
      reason: parsed.data.reason,
      summary: parsed.data.summary,
      contact: { name: ctx.contact.name ?? ctx.contact.profileName, phone: ctx.contact.phone },
      whatsappLink: waLink(ctx.contact.phone),
      lead: ctx.lead ? { id: ctx.lead.id, interest: ctx.lead.interest, temperature: ctx.lead.temperature } : null,
      automationPausedUntil: until.toISOString(),
    },
    at: now,
  });
  await incrementUsage(db, ctx.tenant.id, usagePeriod(now, ctx.tenant.timezone), { handoffs: 1 });

  const status = describeOpenStatus(getOpenStatus(ctx.knowledge.hours, now, ctx.tenant.timezone));
  return {
    result: `Transferência registrada; a equipe foi notificada e as respostas automáticas estão pausadas. Funcionamento: ${status} Avise o cliente agora, com base em: "${ctx.agent.handoffMessage}"`,
    handoff: parsed.data,
  };
}

export async function executeTool(runtime: ToolRuntime, name: string, input: unknown): Promise<ToolOutcome> {
  switch (name) {
    case "save_lead":
      return saveLead(runtime, input);
    case "transfer_to_human":
      return transferToHuman(runtime, input);
    default:
      return { result: `Ferramenta desconhecida: ${name}`, isError: true };
  }
}
