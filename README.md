# Luma — Agentes de atendimento com IA

Plataforma multi-cliente da **Luma** para vender e operar **agentes de atendimento com IA** para empresas: atende pelo **WhatsApp oficial (Cloud API)**,
responde só com as informações cadastradas da empresa, capta e qualifica leads, transfere para humanos e integra com
automações (n8n). Instagram e chat de site estão previstos na arquitetura.

**Status:** Fase 1 (arquitetura) ✅ · Fase 2 (MVP do agente) ✅ código e testes — próximo passo: piloto com credenciais reais · Fase 3 (painel) a seguir.

## Documentação

| | |
|---|---|
| [1. Arquitetura](docs/01-arquitetura.md) | Tecnologias escolhidas e por quê, fluxo da mensagem, isolamento, confiabilidade |
| [2. Custos](docs/02-custos.md) | Custo por cliente (IA, WhatsApp, infraestrutura) e preços sugeridos |
| [3. MVP](docs/03-mvp.md) | Escopo, o que foi testado e critérios do piloto |
| [4. Banco de dados](docs/04-banco-de-dados.md) | Modelo de dados, regras de integridade e tabelas futuras |
| [5. Plano](docs/05-plano.md) | Fases 1–6 e próximos passos |
| [6. Segurança e LGPD](docs/06-seguranca-lgpd.md) | Controles implementados e obrigações |
| Configuração | [Meta/WhatsApp](docs/setup/whatsapp-meta.md) · [Supabase](docs/setup/supabase.md) · [Anthropic](docs/setup/anthropic.md) · [Vercel](docs/setup/vercel.md) · [n8n](docs/setup/n8n.md) |

## Stack

Next.js 16 (Route Handlers, `after()`) · TypeScript · Supabase Postgres (RLS) · Anthropic SDK (Claude Haiku 5.5) ·
WhatsApp Cloud API · Zod · postgres.js · Vitest · Vercel (gru1).

## Começando (local)

Requisitos: Node 22+ e um Postgres (Supabase CLI ou Docker — ver [setup/supabase.md](docs/setup/supabase.md)).

```bash
npm install
cp .env.example .env.local        # preencha; gere segredos com: npm run keys:generate
npm run db:migrate -- --local     # Postgres puro (com Supabase CLI use: npx supabase db reset)
npm run tenant:apply -- tenants/odontovita.json   # empresa de exemplo (fictícia)
npm run chat -- --tenant odontovita               # converse com o agente no terminal (IA real)
npm run dev                                       # API em http://localhost:3000
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run check` | typecheck + lint + testes |
| `npm test` | unitários + integração (integração exige `TEST_DATABASE_URL`, banco descartável) |
| `npm run db:migrate [-- --local]` | aplica `supabase/migrations` |
| `npm run tenant:apply -- <arquivo>` | cadastra/atualiza uma empresa a partir do JSON (idempotente) |
| `npm run channel:connect -- --tenant <slug> --phone-number-id <id> --waba-id <id>` | conecta um número (token via `WHATSAPP_ACCESS_TOKEN`) |
| `npm run webhook:add -- --tenant <slug> --url <https://…> --events a,b` | envia eventos para o n8n |
| `npm run chat -- --tenant <slug>` | simulador de conversa (desenvolvimento) |
| `npm run webhook:smoke -- --url <…> --phone-number-id <id>` | envia um webhook assinado como a Meta |
| `npm run keys:generate` | gera chave de criptografia, verify token e segredo do cron |

## Novo cliente em 4 passos

1. Copie `tenants/odontovita.json` para `tenants/<slug>.json` e preencha empresa, agente, horários, catálogo, FAQs e regras.
2. `npm run tenant:apply -- tenants/<slug>.json` (valida tudo e mede o tamanho da base de conhecimento).
3. Calibre com `npm run chat -- --tenant <slug>`.
4. Conecte o número com `npm run channel:connect` e, se quiser, os eventos com `npm run webhook:add`.

## Endpoints

| Rota | Uso |
|---|---|
| `GET/POST /api/webhooks/whatsapp` | verificação e recebimento de webhooks da Meta (assinatura obrigatória) |
| `GET /api/cron/jobs` | rede de segurança da fila (Vercel Cron, `Authorization: Bearer CRON_SECRET`) |
| `GET /api/health` | saúde da aplicação e do banco |
