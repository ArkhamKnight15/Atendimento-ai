/**
 * Tipos de domínio compartilhados pelo backend.
 * Espelham as tabelas (colunas em camelCase pelo transform do postgres.js).
 */
import type { BusinessHoursInterval } from "./lib/business-hours";

export const SUPPORTED_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;

/** Serviço único da Luma (ver supabase/migrations/*_seed_plans.sql). */
export const DEFAULT_PLAN_CODE = "luma";
export type SupportedModel = (typeof SUPPORTED_MODELS)[number];
export type Effort = "low" | "medium" | "high";

export interface PlanFeatures {
  faq: boolean;
  leadCapture: boolean;
  leadQualification: boolean;
  scheduling: boolean;
  automations: boolean;
  reports: boolean;
  followUps: boolean;
  customFlows: boolean;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  monthlyAiReplies: number;
  monthlyAiBudgetUsdMicros: number;
  maxChannels: number;
  features: Partial<PlanFeatures>;
  aiModel: SupportedModel;
  aiEffort: Effort;
}

export type TenantStatus = "onboarding" | "active" | "suspended" | "canceled";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  segment: string | null;
  description: string | null;
  status: TenantStatus;
  planId: string;
  limitsOverride: { monthlyAiReplies?: number; monthlyAiBudgetUsdMicros?: number };
  timezone: string;
  address: string | null;
  city: string | null;
  state: string | null;
  mapsUrl: string | null;
  website: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  privacyPolicyUrl: string | null;
}

export interface Agent {
  id: string;
  tenantId: string;
  name: string;
  isActive: boolean;
  tone: string;
  greeting: string | null;
  instructions: string | null;
  businessRules: string[];
  allowedInfo: string[];
  restrictedInfo: string[];
  handoffTriggers: string[];
  qualificationQuestions: string[];
  handoffMessage: string;
  fallbackMessage: string;
  aiModel: SupportedModel | null;
  aiEffort: Effort | null;
  maxReplyChars: number;
  handoffTimeoutMinutes: number;
  updatedAt: Date;
}

export type ChannelType = "whatsapp" | "instagram" | "webchat";

export interface Channel {
  id: string;
  tenantId: string;
  agentId: string;
  type: ChannelType;
  name: string;
  externalId: string;
  displayPhoneNumber: string | null;
  wabaId: string | null;
  status: "pending" | "active" | "paused" | "error";
}

export interface Contact {
  id: string;
  tenantId: string;
  channelType: ChannelType;
  externalId: string;
  name: string | null;
  profileName: string | null;
  phone: string | null;
  email: string | null;
  marketingOptOutAt: Date | null;
  privacyNoticeSentAt: Date | null;
}

export type ConversationStatus = "open" | "human" | "closed";

export interface Conversation {
  id: string;
  tenantId: string;
  channelId: string;
  contactId: string;
  status: ConversationStatus;
  handoffReason: string | null;
  handoffAt: Date | null;
  handoffUntil: Date | null;
  lastInboundAt: Date | null;
  lastMessageAt: Date;
  createdAt: Date;
}

export type MessageSender = "contact" | "ai" | "human" | "system";
export type MessageStatus = "received" | "pending" | "sent" | "delivered" | "read" | "failed" | "ignored";

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  sender: MessageSender;
  type: string;
  content: string | null;
  externalId: string | null;
  status: MessageStatus;
  processedAt: Date | null;
  createdAt: Date;
}

export interface CatalogItem {
  id: string;
  kind: "service" | "product";
  name: string;
  description: string | null;
  priceType: "fixed" | "starting_at" | "on_request";
  priceCents: number | null;
  durationMinutes: number | null;
}

export interface Faq {
  question: string;
  answer: string;
}

export interface KnowledgeEntry {
  title: string;
  content: string;
}

export interface KnowledgeBase {
  catalog: CatalogItem[];
  faqs: Faq[];
  entries: KnowledgeEntry[];
  hours: BusinessHoursInterval[];
}

export type LeadTemperature = "cold" | "warm" | "hot";

export interface Lead {
  id: string;
  tenantId: string;
  contactId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  interest: string | null;
  notes: string | null;
  temperature: LeadTemperature | null;
  qualification: { question: string; answer: string }[];
  stage: "new" | "qualified" | "contacted" | "won" | "lost";
  createdAt: Date;
}

/** Tudo que o agente precisa para responder uma conversa. */
export interface AgentContext {
  tenant: Tenant;
  plan: Plan;
  agent: Agent;
  channel: Channel;
  contact: Contact;
  conversation: Conversation;
  knowledge: KnowledgeBase;
  lead: Lead | null;
}

export interface EffectiveLimits {
  monthlyAiReplies: number;
  monthlyAiBudgetUsdMicros: number;
}

export function effectiveLimits(plan: Plan, tenant: Tenant): EffectiveLimits {
  return {
    monthlyAiReplies: tenant.limitsOverride.monthlyAiReplies ?? plan.monthlyAiReplies,
    monthlyAiBudgetUsdMicros: tenant.limitsOverride.monthlyAiBudgetUsdMicros ?? plan.monthlyAiBudgetUsdMicros,
  };
}

export function hasFeature(plan: Plan, feature: keyof PlanFeatures): boolean {
  return plan.features[feature] === true;
}
