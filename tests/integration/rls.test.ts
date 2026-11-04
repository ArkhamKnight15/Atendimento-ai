import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "../../src/server/db/client";
import { generateKey } from "../../src/server/lib/crypto";
import { createTestDatabase, TEST_DATABASE_URL } from "../helpers/db";
import { createTenant, type TenantFixture } from "../helpers/fixtures";

/**
 * Isolamento entre empresas pelo caminho do painel (papel `authenticated` + RLS),
 * exatamente como o Supabase executa as consultas da Data API.
 */
describe.skipIf(!TEST_DATABASE_URL)("RLS: isolamento entre empresas", () => {
  let sql: Sql;
  let a: TenantFixture;
  let b: TenantFixture;
  const users = { ownerA: randomUUID(), agentB: randomUUID(), viewerA: randomUUID(), admin: randomUUID(), outsider: randomUUID() };

  /** Executa como um usuário autenticado do Supabase (JWT com `sub`). */
  async function asUser<T>(userId: string | null, fn: (tx: Sql) => Promise<T>): Promise<T> {
    try {
      return await sql.begin(async (tx) => {
        await tx.unsafe(`set local role ${userId ? "authenticated" : "anon"}`);
        await tx`select set_config('request.jwt.claims', ${JSON.stringify(userId ? { sub: userId, role: "authenticated" } : {})}, true)`;
        const result = await fn(tx as unknown as Sql);
        throw Object.assign(new Error("rollback"), { result }); // sempre desfaz
      });
    } catch (error) {
      if (error instanceof Error && error.message === "rollback") return (error as Error & { result: T }).result;
      throw error;
    }
  }

  beforeAll(async () => {
    sql = await createTestDatabase();
    const key = generateKey();
    a = await createTenant(sql, { slug: "empresa-a", phoneNumberId: "1000000001", encryptionKey: key });
    b = await createTenant(sql, { slug: "empresa-b", phoneNumberId: "2000000002", encryptionKey: key });
    for (const id of Object.values(users)) await sql`insert into auth.users (id, email) values (${id}, ${`${id}@t.dev`})`;
    await sql`insert into public.tenant_members (tenant_id, user_id, role) values
      (${a.tenantId}, ${users.ownerA}, 'owner'), (${b.tenantId}, ${users.agentB}, 'agent'), (${a.tenantId}, ${users.viewerA}, 'viewer')`;
    await sql`insert into private.platform_admins (user_id) values (${users.admin})`;

    // dados de atendimento nas duas empresas
    for (const t of [a, b]) {
      const [contact] = await sql<{ id: string }[]>`
        insert into public.contacts (tenant_id, channel_type, external_id, phone) values (${t.tenantId}, 'whatsapp', '5511999990000', '5511999990000') returning id`;
      await sql`insert into public.leads (tenant_id, contact_id, name) values (${t.tenantId}, ${contact!.id}, ${`Lead ${t.tenantId}`})`;
    }
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("membro enxerga apenas a própria empresa", async () => {
    const tenants = await asUser(users.ownerA, (tx) => tx<{ id: string }[]>`select id from public.tenants`);
    expect(tenants.map((t) => t.id)).toEqual([a.tenantId]);

    const leads = await asUser(users.ownerA, (tx) => tx<{ tenantId: string }[]>`select tenant_id from public.leads`);
    expect(leads).toHaveLength(1);
    expect(leads[0]?.tenantId).toBe(a.tenantId);

    const faqsB = await asUser(users.agentB, (tx) => tx<{ tenantId: string }[]>`select tenant_id from public.faqs`);
    expect(faqsB.every((f) => f.tenantId === b.tenantId)).toBe(true);
  });

  it("não é possível alterar dados de outra empresa", async () => {
    const updated = await asUser(users.ownerA, (tx) =>
      tx`update public.leads set notes = 'invadido' where tenant_id = ${b.tenantId} returning id`,
    );
    expect(updated).toHaveLength(0);
  });

  it("owner altera a configuração; viewer e agent não", async () => {
    const byOwner = await asUser(users.ownerA, (tx) => tx`update public.faqs set answer = 'nova' where tenant_id = ${a.tenantId} returning id`);
    expect(byOwner.length).toBeGreaterThan(0);
    const byViewer = await asUser(users.viewerA, (tx) => tx`update public.faqs set answer = 'nova' where tenant_id = ${a.tenantId} returning id`);
    expect(byViewer).toHaveLength(0);
    const byAgent = await asUser(users.agentB, (tx) => tx`update public.faqs set answer = 'nova' where tenant_id = ${b.tenantId} returning id`);
    expect(byAgent).toHaveLength(0);
  });

  it("agent opera leads da própria empresa (gatilho de updated_at funciona sob RLS)", async () => {
    const rows = await asUser(users.agentB, (tx) =>
      tx<{ stage: string }[]>`update public.leads set stage = 'contacted' where tenant_id = ${b.tenantId} returning stage`,
    );
    expect(rows).toEqual([{ stage: "contacted" }]);
  });

  it("membro não troca o próprio canal nem cadastra webhooks (operação da agência)", async () => {
    const channels = await asUser(users.ownerA, (tx) => tx`update public.channels set status = 'paused' where tenant_id = ${a.tenantId} returning id`);
    expect(channels).toHaveLength(0);
    await expect(
      asUser(users.ownerA, (tx) => tx`insert into public.webhook_endpoints (tenant_id, name, url, events) values (${a.tenantId}, 'x', 'https://x.dev', '{lead.created}')`),
    ).rejects.toThrow(/row-level security/);
  });

  it("credenciais e filas não são acessíveis pelo painel", async () => {
    await expect(asUser(users.ownerA, (tx) => tx`select * from private.channel_credentials`)).rejects.toThrow(/permission denied/);
    await expect(asUser(users.admin, (tx) => tx`select * from private.jobs`)).rejects.toThrow(/permission denied/);
  });

  it("administrador da plataforma vê todas as empresas", async () => {
    const tenants = await asUser(users.admin, (tx) => tx`select id from public.tenants`);
    expect(tenants).toHaveLength(2);
  });

  it("usuário sem vínculo e visitante anônimo não veem nada", async () => {
    expect(await asUser(users.outsider, (tx) => tx`select id from public.tenants`)).toHaveLength(0);
    expect(await asUser(users.outsider, (tx) => tx`select id from public.plans`)).toHaveLength(3);
    await expect(asUser(null, (tx) => tx`select id from public.tenants`)).rejects.toThrow(/permission denied/);
  });
});
