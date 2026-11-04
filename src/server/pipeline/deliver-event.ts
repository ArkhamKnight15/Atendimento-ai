import { loadDelivery, recordDeliveryResult } from "../db/events";
import { decryptSecret, hmacSha256Hex } from "../lib/crypto";
import type { Deps } from "./deps";
import { TransientError } from "./errors";

export const WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";
export const WEBHOOK_TIMESTAMP_HEADER = "x-webhook-timestamp";

/** Assinatura `v1=<hex>` = HMAC-SHA256(segredo, `${timestamp}.${corpo}`). */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

/**
 * Entrega um evento para um endpoint (ex.: workflow do n8n). Falhas de rede,
 * 429 e 5xx são retentadas com backoff pela fila; outros 4xx são definitivos.
 */
export async function deliverEvent(deps: Deps, deliveryId: string, options: { finalAttempt: boolean }) {
  const delivery = await loadDelivery(deps.sql, deliveryId);
  if (!delivery || delivery.status !== "pending" || !delivery.endpointActive) return;

  const body = JSON.stringify({
    id: delivery.eventId,
    type: delivery.eventType,
    createdAt: delivery.createdAt.toISOString(),
    tenant: { id: delivery.tenantId, slug: delivery.tenantSlug },
    data: delivery.payload,
  });
  const timestamp = Math.floor(deps.now().getTime() / 1000);
  const secret = decryptSecret(delivery.secretEnc, deps.encryptionKey);

  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const response = await deps.fetch(delivery.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "atendimento-ai-webhooks/1",
        "X-Webhook-Id": delivery.eventId,
        "X-Webhook-Event": delivery.eventType,
        "X-Webhook-Timestamp": String(timestamp),
        "X-Webhook-Signature": signWebhook(secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    statusCode = response.status;
    if (!response.ok) error = `HTTP ${response.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const ok = error === null;
  const retryable = !ok && (statusCode === null || statusCode === 429 || statusCode >= 500);
  const final = ok || !retryable || options.finalAttempt;
  await recordDeliveryResult(deps.sql, {
    deliveryId,
    endpointId: delivery.endpointId,
    ok,
    statusCode,
    error,
    final,
    at: deps.now(),
  });
  if (!ok && retryable && !options.finalAttempt) throw new TransientError(`Entrega do webhook falhou: ${error}`);
  if (!ok) deps.logger.warn("entrega de webhook descartada", { deliveryId, statusCode, error });
}
