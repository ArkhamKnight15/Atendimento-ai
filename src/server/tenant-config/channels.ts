import type { Sql } from "../db/client";
import { encryptSecret } from "../lib/crypto";

export interface ConnectWhatsAppInput {
  tenantSlug: string;
  phoneNumberId: string;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  name: string;
  accessToken: string;
  encryptionKey: string;
  status?: "pending" | "active";
}

/**
 * Vincula um número da WhatsApp Cloud API a uma empresa e guarda o token
 * criptografado. Respeita o limite de canais do plano.
 */
export async function connectWhatsAppChannel(sql: Sql, input: ConnectWhatsAppInput) {
  if (!/^\d{5,30}$/.test(input.phoneNumberId)) throw new Error("phone_number_id deve conter apenas dígitos.");
  const tokenEnc = encryptSecret(input.accessToken, input.encryptionKey);

  return sql.begin(async (tx) => {
    const [tenant] = await tx<{ id: string; maxChannels: number }[]>`
      select t.id, p.max_channels from public.tenants t join public.plans p on p.id = t.plan_id
      where t.slug = ${input.tenantSlug}`;
    if (!tenant) throw new Error(`Empresa "${input.tenantSlug}" não encontrada. Rode tenant:apply antes.`);

    const [agent] = await tx<{ id: string }[]>`
      select id from public.agents where tenant_id = ${tenant.id} order by created_at limit 1`;
    if (!agent) throw new Error("Empresa sem agente configurado.");

    const [existing] = await tx<{ id: string; tenantId: string }[]>`
      select id, tenant_id from public.channels where type = 'whatsapp' and external_id = ${input.phoneNumberId}`;
    if (existing && existing.tenantId !== tenant.id) {
      throw new Error("Este phone_number_id já está vinculado a outra empresa.");
    }
    if (!existing) {
      const [usage] = await tx<{ count: number }[]>`
        select count(*)::int as count from public.channels where tenant_id = ${tenant.id} and status <> 'paused'`;
      if ((usage?.count ?? 0) >= tenant.maxChannels) {
        throw new Error(`O plano permite ${tenant.maxChannels} canal(is) ativo(s). Pause um canal ou mude de plano.`);
      }
    }

    const [channel] = await tx<{ id: string }[]>`
      insert into public.channels (tenant_id, agent_id, type, name, external_id, display_phone_number, waba_id, status)
      values (${tenant.id}, ${agent.id}, 'whatsapp', ${input.name}, ${input.phoneNumberId}, ${input.displayPhoneNumber},
              ${input.wabaId}, ${input.status ?? "active"})
      on conflict (type, external_id) do update set
        name = excluded.name, display_phone_number = coalesce(excluded.display_phone_number, public.channels.display_phone_number),
        waba_id = coalesce(excluded.waba_id, public.channels.waba_id), status = excluded.status,
        last_error = null, last_error_at = null
      returning id`;

    await tx`
      insert into private.channel_credentials (channel_id, access_token_enc)
      values (${channel!.id}, ${tokenEnc})
      on conflict (channel_id) do update set access_token_enc = excluded.access_token_enc`;

    return { tenantId: tenant.id, channelId: channel!.id, created: !existing };
  });
}
