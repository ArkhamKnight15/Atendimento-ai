import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { Sql } from "../db/client";
import { EVENT_TYPES, type EventType } from "../db/events";
import { encryptSecret } from "../lib/crypto";

/** Bloqueia destinos internos (proteção contra SSRF). */
export function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL inválida.");
  }
  if (url.protocol !== "https:") throw new Error("A URL do webhook precisa usar HTTPS.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const privateHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (isIP(host) === 4 && /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host)) ||
    (isIP(host) === 6 && /^(::1?$|f[cd][0-9a-f]{2}:|fe80:)/.test(host));
  if (privateHost) throw new Error("A URL do webhook não pode apontar para endereços internos.");
  return url;
}

export async function addWebhookEndpoint(
  sql: Sql,
  input: { tenantSlug: string; name: string; url: string; events: string[]; encryptionKey: string },
) {
  assertPublicHttpsUrl(input.url);
  const unknown = input.events.filter((e) => !EVENT_TYPES.includes(e as EventType));
  if (input.events.length === 0 || unknown.length) {
    throw new Error(`Eventos inválidos: ${unknown.join(", ") || "(nenhum)"}. Válidos: ${EVENT_TYPES.join(", ")}`);
  }
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;

  return sql.begin(async (tx) => {
    const [tenant] = await tx<{ id: string }[]>`select id from public.tenants where slug = ${input.tenantSlug}`;
    if (!tenant) throw new Error(`Empresa "${input.tenantSlug}" não encontrada.`);
    const [endpoint] = await tx<{ id: string }[]>`
      insert into public.webhook_endpoints (tenant_id, name, url, events)
      values (${tenant.id}, ${input.name}, ${input.url}, ${input.events})
      on conflict (tenant_id, name) do update set url = excluded.url, events = excluded.events, is_active = true
      returning id`;
    await tx`
      insert into private.webhook_endpoint_secrets (endpoint_id, secret_enc)
      values (${endpoint!.id}, ${encryptSecret(secret, input.encryptionKey)})
      on conflict (endpoint_id) do update set secret_enc = excluded.secret_enc`;
    return { endpointId: endpoint!.id, secret };
  });
}
