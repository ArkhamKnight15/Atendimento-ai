# 3. Escopo do MVP (Fase 2)

Objetivo: **um agente funcional no WhatsApp oficial** que atende com base nas informações cadastradas da empresa, capta e qualifica leads, transfere para humano quando necessário e registra tudo, com isolamento entre empresas desde o primeiro cliente.

## Incluído — implementado e testado

| Área | Funcionalidade | Onde |
|---|---|---|
| WhatsApp | Verificação do webhook, validação de assinatura `X-Hub-Signature-256`, recebimento de texto/botões/listas/localização, aviso ao cliente quando chega áudio/imagem/documento, status de entrega (sent/delivered/read/failed), envio de texto, "lida + digitando…" | `src/server/whatsapp`, `src/app/api/webhooks/whatsapp` |
| Confiabilidade | Dedupe por `wamid`, agrupamento de mensagens em sequência, um worker por conversa, outbox de envio, retentativas com backoff, recuperação de jobs travados (cron), mensagem de contingência | `src/server/pipeline`, `src/server/db/jobs.ts` |
| IA | Prompt gerado a partir da configuração da empresa (persona, tom, regras, o que pode e não pode informar, gatilhos de transferência), base de conhecimento completa em cache, contexto do turno (data/hora, aberto/fechado, dados do contato e do lead), regras contra respostas inventadas, formatação para WhatsApp | `src/server/ai` |
| Captação | Ferramenta `save_lead`: nome, e-mail, interesse, observações. No plano Profissional/Avançado também temperatura (frio/morno/quente) e respostas de qualificação | `src/server/ai/tools.ts` |
| Transferência | Ferramenta `transfer_to_human` com resumo para a equipe. A IA fica pausada por um tempo configurável e depois é retomada | idem |
| Integrações | Eventos assinados (HMAC) para n8n ou qualquer URL: `lead.created`, `lead.updated`, `lead.hot`, `conversation.handoff_requested`, `contact.opted_out`, `contact.opted_in`, `usage.limit_warning`, `usage.limit_reached` | `src/server/db/events.ts`, `pipeline/deliver-event.ts` |
| Planos | Limites de respostas/mês e de custo de IA/mês por plano (com sobrescrita por empresa), recursos por plano, aviso aos 80%, transferência ao atingir 100% | `supabase/migrations/*seed_plans.sql`, `pipeline/process-conversation.ts` |
| LGPD | SAIR/QUERO RECEBER (descadastro e recadastro de comunicações), aviso de privacidade na primeira resposta, logs com telefone e conteúdo mascarados | `pipeline/guardrails.ts`, `lib/logger.ts` |
| Multi-cliente | Esquema com `tenant_id` + FKs compostas, RLS para o painel, credenciais criptografadas, roteamento por número | `supabase/migrations` |
| Onboarding | Cadastro de empresa por arquivo JSON validado, conexão de número (valida na Meta e inscreve o app), cadastro de webhook, simulador de conversa no terminal, smoke test de webhook | `scripts/`, `tenants/` |
| Métricas (dados) | `agent_runs` (tokens, custo, latência, ferramentas por resposta), `usage_monthly` (respostas, mensagens, leads, transferências, custo) | base dos relatórios da Fase 3 |

## Fora do MVP (fases seguintes)

- Painel administrativo, login e caixa de entrada humana → **Fase 3**
- Agendamento (Google Calendar), lembretes, follow-ups com templates, CRM com etapas → **Fase 4**
- Áudio (transcrição) e imagens → **Fase 4**
- RAG para bases grandes, observabilidade avançada, testes de carga → **Fase 5**
- Embedded Signup da Meta (onboarding self-service), cobrança recorrente → **Fase 6**

## Como foi testado

- **Unitários (31):** horários com fuso, formatação, palavras-chave LGPD, criptografia, assinatura da Meta e dos webhooks, preços, validação de configuração, proteção SSRF, parser do webhook, cliente da Graph API (sucesso e classificação de erros).
- **Integração com Postgres real (20):** RLS (8 cenários de isolamento e permissões) e o pipeline completo (12 cenários). O pipeline cobre resposta com cache e aviso de privacidade, idempotência, agrupamento, lead e entrega assinada ao n8n, transferência com pausa e retomada, descadastro, isolamento entre empresas, limite do plano, falha transitória e definitiva da IA, recusa, status de entrega e token inválido, e exclusividade da fila com recuperação de job travado. A IA e o WhatsApp são substituídos por dublês **apenas nos testes**.
- **Ponta a ponta com `next start`:** requisições HTTP reais com assinatura da Meta (válida, inválida e ausente), verificação do webhook, reentrega, número desconhecido, cron autenticado, chamada real à API da Anthropic (falha de autenticação tratada com contingência e transferência) e falha de rede no envio (mensagem preservada para reenvio).

**Ainda não validado (exige suas credenciais):** uma resposta real do Claude e um envio real pela Graph API. O roteiro está em [setup/whatsapp-meta.md](setup/whatsapp-meta.md#teste-de-ponta-a-ponta). Use primeiro o simulador (`npm run chat`) e depois o número de teste da Meta.

## Critérios de aceite do piloto

1. 50 conversas reais (ou simuladas por pessoas da equipe) sem resposta inventada sobre preço, horário ou política.
2. 100% das conversas com pedido de atendente ou reclamação transferidas e notificadas.
3. Leads registrados com nome e interesse em ≥ 90% das conversas com intenção comercial.
4. Tempo de resposta (p95) abaixo de 10 s, contando o agrupamento de 2,5 s.
5. Custo médio por resposta abaixo de US$ 0,001 (`agent_runs`).
