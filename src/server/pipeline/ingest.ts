import { findChannelByExternalId, touchChannelInbound } from "../db/context";
import {
  getOrOpenConversation,
  inboundExists,
  insertInboundMessage,
  applyDeliveryStatus,
  upsertWhatsAppContact,
} from "../db/conversations";
import { enqueueJob } from "../db/jobs";
import { incrementUsage, usagePeriod } from "../db/usage";
import type { Channel } from "../domain";
import type { ParsedWebhook } from "../whatsapp/webhook";
import type { Deps } from "./deps";

export interface ScheduledJob {
  id: number;
  runAt: Date;
}

export interface IngestResult {
  stored: number;
  duplicates: number;
  unknownChannel: number;
  statuses: number;
  jobs: ScheduledJob[];
}

/**
 * Persiste o webhook de forma idempotente e agenda o processamento.
 * Nenhuma chamada lenta (IA, Graph API) acontece aqui: a resposta à Meta
 * precisa ser rápida para evitar reentregas.
 */
export async function ingestWebhook(deps: Deps, webhook: ParsedWebhook): Promise<IngestResult> {
  const result: IngestResult = { stored: 0, duplicates: 0, unknownChannel: 0, statuses: 0, jobs: [] };
  const channels = new Map<string, Channel | null>();
  const getChannel = async (phoneNumberId: string) => {
    if (!channels.has(phoneNumberId)) channels.set(phoneNumberId, await findChannelByExternalId(deps.sql, "whatsapp", phoneNumberId));
    return channels.get(phoneNumberId) ?? null;
  };

  for (const message of webhook.messages) {
    const channel = await getChannel(message.phoneNumberId);
    if (!channel) {
      result.unknownChannel += 1;
      deps.logger.warn("webhook para phone_number_id não cadastrado", { phoneNumberId: message.phoneNumberId });
      continue;
    }

    const now = deps.now();
    const outcome = await deps.sql.begin(async (tx) => {
      // Serializa a ingestão por contato: evita duas conversas abertas em entregas simultâneas.
      await tx`select pg_advisory_xact_lock(hashtextextended(${`ingest:${channel.tenantId}:${message.from}`}, 0))`;
      if (await inboundExists(tx, channel.tenantId, message.externalId)) return { duplicate: true as const };

      const contact = await upsertWhatsAppContact(tx, {
        tenantId: channel.tenantId,
        waId: message.from,
        profileName: message.profileName,
        at: message.sentAt,
      });
      const { conversation } = await getOrOpenConversation(tx, {
        tenantId: channel.tenantId,
        channelId: channel.id,
        contactId: contact.id,
        now,
      });
      const stored = await insertInboundMessage(tx, {
        tenantId: channel.tenantId,
        conversationId: conversation.id,
        externalId: message.externalId,
        type: message.type,
        content: message.content,
        payload: message.raw,
        createdAt: message.sentAt,
        needsReply: message.needsReply,
      });
      if (!stored) return { duplicate: true as const };

      await touchChannelInbound(tx, channel.id, now);
      const tenant = await tx<{ timezone: string }[]>`select timezone from public.tenants where id = ${channel.tenantId}`;
      await incrementUsage(tx, channel.tenantId, usagePeriod(now, tenant[0]?.timezone ?? "America/Sao_Paulo"), {
        inboundMessages: 1,
      });

      if (!message.needsReply) return { duplicate: false as const, job: null };
      const job = await enqueueJob(tx, {
        tenantId: channel.tenantId,
        kind: "process_conversation",
        refId: conversation.id,
        runAt: new Date(now.getTime() + deps.debounceMs),
      });
      return { duplicate: false as const, job: { id: job.id, runAt: job.runAt } };
    });

    if (outcome.duplicate) {
      result.duplicates += 1;
      continue;
    }
    result.stored += 1;
    if (outcome.job) {
      const existing = result.jobs.find((j) => j.id === outcome.job.id);
      if (existing) existing.runAt = outcome.job.runAt;
      else result.jobs.push(outcome.job);
    }
  }

  for (const status of webhook.statuses) {
    const channel = await getChannel(status.phoneNumberId);
    if (!channel) continue;
    await applyDeliveryStatus(deps.sql, { channelId: channel.id, ...status });
    result.statuses += 1;
    if (status.status === "failed") {
      deps.logger.warn("falha de entrega reportada pela Meta", {
        channelId: channel.id,
        errorCode: status.errorCode,
        errorMessage: status.errorMessage,
      });
    }
  }

  return result;
}
