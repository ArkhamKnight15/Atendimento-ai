-- =============================================================================
-- Núcleo multi-cliente da plataforma de agentes de atendimento.
--
-- Princípios:
--   * Toda linha de dado de cliente carrega tenant_id.
--   * Chaves estrangeiras compostas (tenant_id, id) impedem, no próprio banco,
--     que um registro aponte para dados de outra empresa.
--   * O schema `public` é exposto pela Data API do Supabase e protegido por RLS.
--   * O schema `private` (credenciais, filas, eventos) NÃO é exposto e só é
--     acessado pelo backend.
--   * Enumerações são `text` + CHECK para evoluírem sem migrações de tipo.
-- =============================================================================

create schema if not exists private;

-- -----------------------------------------------------------------------------
-- Utilitário: updated_at automático
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Planos comerciais (limites e funcionalidades)
-- -----------------------------------------------------------------------------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]+$'),
  name text not null,
  description text,
  monthly_price_cents integer not null default 0 check (monthly_price_cents >= 0),
  setup_price_cents integer not null default 0 check (setup_price_cents >= 0),
  -- respostas da IA inclusas no mês; acima disso o excedente é cobrado (a IA continua)
  monthly_ai_replies integer not null check (monthly_ai_replies > 0),
  -- teto de custo de IA por mês, em micro-dólares: trava de segurança contra abuso/loops (pausa a IA)
  monthly_ai_budget_usd_micros bigint not null check (monthly_ai_budget_usd_micros > 0),
  max_channels integer not null default 1 check (max_channels > 0),
  features jsonb not null default '{}'::jsonb,
  ai_model text not null default 'claude-haiku-5-5',
  ai_effort text not null default 'medium' check (ai_effort in ('low', 'medium', 'high')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Empresas clientes (tenants)
-- -----------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(name) between 2 and 120),
  segment text,
  description text,
  status text not null default 'onboarding'
    check (status in ('onboarding', 'active', 'suspended', 'canceled')),
  plan_id uuid not null references public.plans (id),
  -- sobrescritas pontuais do plano: {"monthlyAiReplies": 5000, "monthlyAiBudgetUsdMicros": 20000000}
  limits_override jsonb not null default '{}'::jsonb,
  timezone text not null default 'America/Sao_Paulo',
  address text,
  city text,
  state text,
  maps_url text,
  website text,
  contact_phone text,
  contact_email text,
  privacy_policy_url text check (privacy_policy_url is null or privacy_policy_url ~ '^https://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Usuários do painel vinculados a uma empresa (Supabase Auth)
create table public.tenant_members (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'agent', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_idx on public.tenant_members (user_id);

-- Equipe da agência (acesso a todas as empresas)
create table private.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Agente (persona + regras de atendimento)
-- -----------------------------------------------------------------------------
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(name) between 2 and 60),
  is_active boolean not null default true,
  tone text not null,
  greeting text,
  instructions text,
  business_rules text[] not null default '{}',
  allowed_info text[] not null default '{}',
  restricted_info text[] not null default '{}',
  handoff_triggers text[] not null default '{}',
  qualification_questions text[] not null default '{}',
  handoff_message text not null,
  fallback_message text not null,
  ai_model text,
  ai_effort text check (ai_effort is null or ai_effort in ('low', 'medium', 'high')),
  max_reply_chars integer not null default 700 check (max_reply_chars between 200 and 3000),
  handoff_timeout_minutes integer not null default 720 check (handoff_timeout_minutes between 15 and 10080),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = domingo
  opens_at time not null,
  closes_at time not null,
  check (closes_at > opens_at),
  unique (tenant_id, weekday, opens_at)
);

-- -----------------------------------------------------------------------------
-- Base de conhecimento (fonte única de verdade para o agente)
-- -----------------------------------------------------------------------------
create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null default 'service' check (kind in ('service', 'product')),
  name text not null,
  description text,
  price_type text not null default 'fixed' check (price_type in ('fixed', 'starting_at', 'on_request')),
  price_cents integer check (price_cents is null or price_cents >= 0),
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (price_type = 'on_request' or price_cents is not null),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  question text not null,
  answer text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, question)
);

create table public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title text not null,
  content text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, title)
);

-- -----------------------------------------------------------------------------
-- Canais (WhatsApp agora; Instagram e webchat nas próximas fases)
-- -----------------------------------------------------------------------------
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  agent_id uuid not null,
  type text not null check (type in ('whatsapp', 'instagram', 'webchat')),
  name text not null,
  -- WhatsApp: phone_number_id da Cloud API (roteia o webhook para a empresa)
  external_id text not null,
  display_phone_number text,
  waba_id text,
  status text not null default 'pending' check (status in ('pending', 'active', 'paused', 'error')),
  last_inbound_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (type, external_id),
  unique (tenant_id, id),
  foreign key (tenant_id, agent_id) references public.agents (tenant_id, id)
);

-- Token de acesso criptografado (AES-256-GCM na aplicação). Nunca exposto.
create table private.channel_credentials (
  channel_id uuid primary key references public.channels (id) on delete cascade,
  access_token_enc text not null,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Contatos, conversas e mensagens
-- -----------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  channel_type text not null check (channel_type in ('whatsapp', 'instagram', 'webchat')),
  external_id text not null, -- WhatsApp: wa_id (DDI + DDD + número)
  name text,                 -- nome informado pelo próprio contato
  profile_name text,         -- nome do perfil no WhatsApp
  phone text,
  email text,
  -- LGPD / comunicações comerciais
  marketing_opt_out_at timestamptz,
  privacy_notice_sent_at timestamptz,
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, channel_type, external_id),
  unique (tenant_id, id)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  channel_id uuid not null,
  contact_id uuid not null,
  -- open = agente de IA ativo; human = transferida para atendente; closed = encerrada
  status text not null default 'open' check (status in ('open', 'human', 'closed')),
  handoff_reason text,
  handoff_summary text,
  handoff_at timestamptz,
  handoff_until timestamptz,
  -- última mensagem do contato: abre a janela de 24h de atendimento da Meta
  last_inbound_at timestamptz,
  last_message_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, channel_id) references public.channels (tenant_id, id) on delete cascade,
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade
);
-- no máximo uma conversa ativa por contato e canal
create unique index conversations_active_uidx
  on public.conversations (tenant_id, channel_id, contact_id)
  where status <> 'closed';
create index conversations_tenant_recent_idx on public.conversations (tenant_id, last_message_at desc);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  conversation_id uuid not null,
  model text not null,
  effort text,
  status text not null check (status in ('succeeded', 'failed', 'refused')),
  stop_reason text,
  llm_calls integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd_micros bigint not null default 0,
  tool_calls jsonb not null default '[]'::jsonb,
  latency_ms integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references public.conversations (tenant_id, id) on delete cascade
);
create index agent_runs_tenant_created_idx on public.agent_runs (tenant_id, created_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  -- ordem de inserção: desempata mensagens com o mesmo timestamp (o WhatsApp informa segundos)
  seq bigint generated always as identity,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  conversation_id uuid not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender text not null check (sender in ('contact', 'ai', 'human', 'system')),
  type text not null,
  content text,
  payload jsonb,
  -- WhatsApp: wamid. Garante idempotência contra reentregas do webhook.
  external_id text,
  status text not null check (status in ('received', 'pending', 'sent', 'delivered', 'read', 'failed', 'ignored')),
  error_code text,
  error_message text,
  processed_at timestamptz,
  agent_run_id uuid references public.agent_runs (id) on delete set null,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, conversation_id) references public.conversations (tenant_id, id) on delete cascade
);
create unique index messages_external_uidx on public.messages (tenant_id, direction, external_id)
  where external_id is not null;
create index messages_conversation_idx on public.messages (conversation_id, created_at, seq);
create index messages_pending_inbound_idx on public.messages (conversation_id)
  where direction = 'inbound' and processed_at is null;
create index messages_outbound_external_idx on public.messages (external_id)
  where direction = 'outbound' and external_id is not null;

-- -----------------------------------------------------------------------------
-- Leads / oportunidades comerciais
-- -----------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid not null,
  conversation_id uuid,
  name text,
  email text,
  phone text,
  interest text,
  catalog_item_id uuid,
  notes text,
  temperature text check (temperature is null or temperature in ('cold', 'warm', 'hot')),
  qualification jsonb not null default '[]'::jsonb,
  stage text not null default 'new' check (stage in ('new', 'qualified', 'contacted', 'won', 'lost')),
  source text not null default 'whatsapp',
  qualified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, conversation_id) references public.conversations (tenant_id, id) on delete set null (conversation_id),
  foreign key (tenant_id, catalog_item_id) references public.catalog_items (tenant_id, id) on delete set null (catalog_item_id)
);
-- um lead em aberto por contato (histórico preservado nos encerrados)
create unique index leads_open_contact_uidx on public.leads (tenant_id, contact_id)
  where stage not in ('won', 'lost');
create index leads_tenant_created_idx on public.leads (tenant_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Consumo mensal agregado (limites do plano e relatórios)
-- -----------------------------------------------------------------------------
create table public.usage_monthly (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  period date not null, -- primeiro dia do mês no fuso da empresa
  ai_replies integer not null default 0,
  inbound_messages integer not null default 0,
  outbound_messages integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_usd_micros bigint not null default 0,
  leads_created integer not null default 0,
  handoffs integer not null default 0,
  limit_warning_at timestamptz,   -- 80% das respostas inclusas
  limit_reached_at timestamptz,   -- 100% das respostas inclusas (começa o excedente)
  budget_exhausted_at timestamptz, -- teto de custo de IA atingido (IA pausada)
  updated_at timestamptz not null default now(),
  primary key (tenant_id, period)
);

-- -----------------------------------------------------------------------------
-- Integrações: webhooks de saída (ex.: n8n) assinados com HMAC
-- -----------------------------------------------------------------------------
create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  url text not null check (url ~ '^https://'),
  events text[] not null check (cardinality(events) > 0),
  is_active boolean not null default true,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table private.webhook_endpoint_secrets (
  endpoint_id uuid primary key references public.webhook_endpoints (id) on delete cascade,
  secret_enc text not null
);

create table private.events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  type text not null,
  payload jsonb not null,
  dedupe_key text unique,
  created_at timestamptz not null default now()
);
create index events_tenant_created_idx on private.events (tenant_id, created_at desc);

create table private.event_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references private.events (id) on delete cascade,
  endpoint_id uuid not null references public.webhook_endpoints (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0,
  last_status_code integer,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, endpoint_id)
);

-- -----------------------------------------------------------------------------
-- Fila de trabalho (Postgres como fila: SKIP LOCKED + lease por conversa)
-- -----------------------------------------------------------------------------
create table private.jobs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('process_conversation', 'deliver_event')),
  ref_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- no máximo um job aguardando por referência: novas mensagens só adiam o mesmo job (debounce)
create unique index jobs_one_queued_per_ref_uidx on private.jobs (kind, ref_id) where status = 'queued';
create index jobs_due_idx on private.jobs (run_at) where status = 'queued';
create index jobs_running_idx on private.jobs (locked_until) where status = 'running';

-- -----------------------------------------------------------------------------
-- Gatilhos de updated_at
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'public.plans', 'public.tenants', 'public.agents', 'public.catalog_items', 'public.faqs',
    'public.knowledge_entries', 'public.channels', 'public.contacts', 'public.conversations',
    'public.leads', 'public.usage_monthly', 'public.webhook_endpoints', 'private.jobs',
    'private.channel_credentials'
  ]
  loop
    execute format('create trigger set_updated_at before update on %s for each row execute function private.set_updated_at()', t);
  end loop;
end;
$$;
