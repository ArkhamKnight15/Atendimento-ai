-- =============================================================================
-- Isolamento entre empresas via Row Level Security.
--
-- Papéis de acesso pelo painel (Supabase Auth, role `authenticated`):
--   * platform admin (equipe da agência): lê e altera tudo;
--   * owner/admin da empresa: lê e altera a configuração da própria empresa;
--   * agent: lê tudo da empresa e opera conversas/leads;
--   * viewer: somente leitura.
-- O backend (pipeline do WhatsApp) usa conexão direta como dono das tabelas e
-- não passa por RLS — por isso todo acesso dele é sempre filtrado por tenant_id.
-- =============================================================================

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.platform_admins where user_id = (select auth.uid()));
$$;

create or replace function private.tenant_role(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.tenant_members
  where tenant_id = p_tenant_id and user_id = (select auth.uid());
$$;

create or replace function private.can_read_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin() or private.tenant_role(p_tenant_id) is not null;
$$;

create or replace function private.can_operate_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin() or private.tenant_role(p_tenant_id) in ('owner', 'admin', 'agent');
$$;

create or replace function private.can_manage_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin() or private.tenant_role(p_tenant_id) in ('owner', 'admin');
$$;

-- As funções vivem em `private`; o papel autenticado só precisa executá-las.
revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public;
grant execute on function
  private.is_platform_admin(),
  private.tenant_role(uuid),
  private.can_read_tenant(uuid),
  private.can_operate_tenant(uuid),
  private.can_manage_tenant(uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- RLS habilitado em todas as tabelas expostas
-- -----------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.agents enable row level security;
alter table public.business_hours enable row level security;
alter table public.catalog_items enable row level security;
alter table public.faqs enable row level security;
alter table public.knowledge_entries enable row level security;
alter table public.channels enable row level security;
alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.agent_runs enable row level security;
alter table public.leads enable row level security;
alter table public.usage_monthly enable row level security;
alter table public.webhook_endpoints enable row level security;

-- Planos: catálogo visível para usuários autenticados; edição só pela agência.
create policy plans_read on public.plans for select to authenticated using (true);
create policy plans_admin on public.plans for all to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));

-- Empresas
create policy tenants_read on public.tenants for select to authenticated
  using ((select private.can_read_tenant(id)));
create policy tenants_update on public.tenants for update to authenticated
  using ((select private.can_manage_tenant(id))) with check ((select private.can_manage_tenant(id)));
create policy tenants_admin_insert on public.tenants for insert to authenticated
  with check ((select private.is_platform_admin()));
create policy tenants_admin_delete on public.tenants for delete to authenticated
  using ((select private.is_platform_admin()));

-- Membros
create policy members_read on public.tenant_members for select to authenticated
  using ((select private.can_read_tenant(tenant_id)));
create policy members_manage on public.tenant_members for all to authenticated
  using ((select private.can_manage_tenant(tenant_id))) with check ((select private.can_manage_tenant(tenant_id)));

-- Configuração do agente e base de conhecimento: leitura para membros, escrita para owner/admin.
do $$
declare
  t text;
begin
  foreach t in array array['agents', 'business_hours', 'catalog_items', 'faqs', 'knowledge_entries']
  loop
    execute format(
      'create policy %1$s_read on public.%1$s for select to authenticated using ((select private.can_read_tenant(tenant_id)))', t);
    execute format(
      'create policy %1$s_manage on public.%1$s for all to authenticated using ((select private.can_manage_tenant(tenant_id))) with check ((select private.can_manage_tenant(tenant_id)))', t);
  end loop;
end;
$$;

-- Canais e webhooks de integração: operação da agência (credenciais da Meta,
-- URLs de destino). Membros da empresa apenas consultam.
create policy channels_read on public.channels for select to authenticated
  using ((select private.can_read_tenant(tenant_id)));
create policy channels_admin on public.channels for all to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
create policy webhook_endpoints_read on public.webhook_endpoints for select to authenticated
  using ((select private.can_read_tenant(tenant_id)));
create policy webhook_endpoints_admin on public.webhook_endpoints for all to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));

-- Dados de atendimento: leitura para membros; atualização para quem opera.
do $$
declare
  t text;
begin
  foreach t in array array['contacts', 'conversations', 'leads']
  loop
    execute format(
      'create policy %1$s_read on public.%1$s for select to authenticated using ((select private.can_read_tenant(tenant_id)))', t);
    execute format(
      'create policy %1$s_operate on public.%1$s for update to authenticated using ((select private.can_operate_tenant(tenant_id))) with check ((select private.can_operate_tenant(tenant_id)))', t);
  end loop;
end;
$$;

-- Mensagens, execuções da IA e consumo: somente leitura pelo painel
-- (envio de mensagens humanas passa pelo backend, que fala com a Meta).
create policy messages_read on public.messages for select to authenticated
  using ((select private.can_read_tenant(tenant_id)));
create policy agent_runs_read on public.agent_runs for select to authenticated
  using ((select private.can_read_tenant(tenant_id)));
create policy usage_monthly_read on public.usage_monthly for select to authenticated
  using ((select private.can_read_tenant(tenant_id)));

-- Visitantes anônimos não acessam nada.
revoke all on all tables in schema public from anon;
