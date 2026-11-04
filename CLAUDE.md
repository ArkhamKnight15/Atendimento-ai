# Diretrizes do projeto — Atendimento AI

Responda em português. Atue como engenheiro responsável por um produto comercial usado por empresas reais.

## Regras de negócio que o código não pode quebrar

- **Isolamento entre empresas**: toda consulta do backend filtra por `tenant_id`. Novas tabelas de dados de cliente
  levam `tenant_id`, `unique (tenant_id, id)` e FKs compostas, RLS habilitado e testes em `tests/integration/rls.test.ts`.
- Credenciais e filas ficam no schema `private` (não exposto). Segredos sempre criptografados (`lib/crypto.ts`).
- Ferramentas da IA nunca recebem escopo (empresa/contato) dos argumentos do modelo, sempre do contexto do servidor.
- O agente responde **somente** com dados cadastrados da empresa; nada simulado em produção.
- Nunca deixar o cliente final sem resposta: falhas viram contingência + transferência para humano.
- Mensagens iniciadas pela empresa só com template aprovado e respeitando `marketing_opt_out_at`.

## Convenções

- Núcleo em `src/server` (sem dependência de Next.js); rotas finas em `src/app/api`.
- SQL tipado com postgres.js (`transform: camel`); migrações novas em `supabase/migrations` (nunca editar uma já aplicada em produção).
- Prompt de sistema estável por empresa (cache). Dados voláteis vão em `buildTurnContext`.
- Modelos suportados em `domain.ts` (`SUPPORTED_MODELS`) com preços em `ai/pricing.ts`.
- Antes de concluir: `npm run check` (com `TEST_DATABASE_URL`) e `npm run build`.
- Painel (Fase 3): seguir padrão de SaaS profissional (React + Tailwind + Lucide), responsivo, acessível (WCAG AA),
  estados de loading/erro/vazio, e reutilizar `src/server/tenant-config` para validação.
