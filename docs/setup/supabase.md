# Configuração: Supabase

## Produção

1. Em <https://supabase.com/dashboard>, crie a organização (plano **Pro** antes do primeiro cliente: projetos Free são pausados após uma semana de inatividade e não têm backups diários).
2. **New project**, região **South America (São Paulo) — sa-east-1**. Use uma senha forte para o banco.
3. Em **Project Settings → Database → Connection string**:
   - **Transaction pooler** (porta **6543**) → `DATABASE_URL` da aplicação (Vercel). O código já usa `prepare: false`, que esse modo exige.
   - **Direct connection** ou **Session pooler** (porta **5432**) → use só para rodar migrações.
4. Aplique as migrações (escolha uma opção):
   - Supabase CLI: `npx supabase link --project-ref <ref>` e `npx supabase db push`
   - ou: `DATABASE_URL='<conexão 5432>' npm run db:migrate`
   - As duas registram em `supabase_migrations.schema_migrations`, então você pode alternar entre elas.
5. Confira em **Database → Tables** que o schema `public` tem RLS ativo em todas as tabelas. O schema `private` **não** deve ser adicionado a *Exposed schemas* (Settings → API).
6. Com clientes pagantes, ative **Point-in-Time Recovery** (add-on) em **Database → Backups**.

## Desenvolvimento local

**Opção A — Supabase CLI (recomendada, precisa do Docker):**

```bash
npx supabase init          # cria supabase/config.toml (mantém as migrações existentes)
npx supabase start         # sobe Postgres + Auth locais
npx supabase db reset      # aplica supabase/migrations
# DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

**Opção B — Postgres puro (Docker), sem Auth:**

```bash
docker run -d --name atendimento-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run db:migrate -- --local
```

`--local` cria antes os stubs mínimos do Supabase (schema `auth`, papéis `anon`/`authenticated`). **Nunca** use `--local` num projeto Supabase real.

## Testes de integração

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/atendimento_test npm test
```

O banco de testes é **apagado e recriado** a cada execução. Por segurança, o nome precisa conter `test`.
