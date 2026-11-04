import type { Db } from "./client";
import { enqueueJob } from "./jobs";

export type EventType =
  | "lead.created"
  | "lead.updated"
  | "lead.hot"
  | "conversation.handoff_requested"
  | "contact.opted_out"
  | "contact.opted_in"
  | "usage.limit_warning"
  | "usage.limit_reached"
  | "usage.budget_exhausted";

export const EVENT_TYPES: EventType[] = [
  "lead.created",
  "lead.updated",
  "lead.hot",
  "conversation.handoff_requested",
  "contact.opted_out",
  "contact.opted_in",
  "usage.limit_warning",
  "usage.limit_reached",
  "usage.budget_exhausted",
];

/**
 * Registra um evento de domínio e agenda a entrega para cada webhook ativo
 * da empresa inscrito nesse tipo (outbox transacional: se a transação de
 * negócio falhar, nenhum evento "fantasma" é enviado).
 */
export async function emitEvent(
  db: Db,
  input: { tenantId: string; type: EventType; payload: Record<string, unknown>; dedupeKey?: string; at: Date },
): Promise<string | null> {
  const [event] = await db<{ id: string }[]>`
    insert into private.events (tenant_id, type, payload, dedupe_key, created_at)
    values (${input.tenantId}, ${input.type}, ${db.json(input.payload as never)}, ${input.dedupeKey ?? null}, ${input.at})
    on conflict (dedupe_key) do nothing
    returning id`;
  if (!event) return null;

  const deliveries = await db<{ id: string }[]>`
    insert into private.event_deliveries (event_id, endpoint_id)
    select ${event.id}, e.id from public.webhook_endpoints e
    where e.tenant_id = ${input.tenantId} and e.is_active and ${input.type} = any (e.events)
    returning id`;
  for (const delivery of deliveries) {
    await enqueueJob(db, { tenantId: input.tenantId, kind: "deliver_event", refId: delivery.id, runAt: input.at, maxAttempts: 8 });
  }
  return event.id;
}

export interface DeliveryTarget {
  deliveryId: string;
  tenantId: string;
  tenantSlug: string;
  endpointId: string;
  url: string;
  secretEnc: string;
  eventId: string;
  eventType: EventType;
  payload: Record<string, unknown>;
  createdAt: Date;
  status: "pending" | "delivered" | "failed";
  endpointActive: boolean;
}

export async function loadDelivery(db: Db, deliveryId: string): Promise<DeliveryTarget | null> {
  const [row] = await db<DeliveryTarget[]>`
    select d.id as delivery_id, ev.tenant_id, t.slug as tenant_slug, d.endpoint_id, e.url, s.secret_enc, ev.id as event_id,
      ev.type as event_type, ev.payload, ev.created_at, d.status, e.is_active as endpoint_active
    from private.event_deliveries d
    join private.events ev on ev.id = d.event_id
    join public.tenants t on t.id = ev.tenant_id
    join public.webhook_endpoints e on e.id = d.endpoint_id and e.tenant_id = ev.tenant_id
    join private.webhook_endpoint_secrets s on s.endpoint_id = e.id
    where d.id = ${deliveryId}`;
  return row ?? null;
}

export async function recordDeliveryResult(
  db: Db,
  input: { deliveryId: string; endpointId: string; ok: boolean; statusCode: number | null; error: string | null; final: boolean; at: Date },
) {
  const status = input.ok ? "delivered" : input.final ? "failed" : "pending";
  await db`
    update private.event_deliveries set status = ${status}, attempts = attempts + 1,
      last_status_code = ${input.statusCode}, last_error = ${input.error},
      delivered_at = ${input.ok ? input.at : null}
    where id = ${input.deliveryId}`;
  if (input.ok) {
    await db`update public.webhook_endpoints set last_success_at = ${input.at} where id = ${input.endpointId}`;
  } else {
    await db`
      update public.webhook_endpoints set last_failure_at = ${input.at}, last_error = ${input.error}
      where id = ${input.endpointId}`;
  }
}
