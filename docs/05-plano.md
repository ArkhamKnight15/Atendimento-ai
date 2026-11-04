# 5. Plano de desenvolvimento

Regra: **nenhuma fase começa com erro crítico aberto na anterior**.

| Fase | Status | Entregas | Critério para avançar |
|---|---|---|---|
| **1 — Arquitetura** | ✅ Concluída | Este conjunto de documentos: arquitetura, custos, MVP, banco, segurança/LGPD, guias de configuração | — |
| **2 — MVP** | ✅ Código pronto e testado · ⏳ piloto real | Pipeline WhatsApp → IA → resposta, leads, transferência, eventos para n8n, limites por plano, LGPD básica, scripts de onboarding, 51 testes | Piloto com número de teste da Meta e uma empresa real, cumprindo os [critérios de aceite](03-mvp.md#critérios-de-aceite-do-piloto) |
| **3 — Painel** | Próxima | Ver abaixo | Equipe opera 1 cliente só pelo painel, sem SQL |
| **4 — Automação** | | Ver abaixo | Agendamento e follow-up rodando em 1 cliente por 2 semanas |
| **5 — Escalabilidade** | | Ver abaixo | Teste de carga: 50 empresas e 20 msg/s sem perda |
| **6 — Comercialização** | | Ver abaixo | Novo cliente no ar em menos de 1 dia de trabalho |

## Fase 3 — Painel administrativo (Next.js + Supabase Auth + RLS)

1. Login (e-mail + senha e link mágico), recuperação de senha, convites por empresa, papéis.
2. **Dashboard**: contatos recebidos, conversas, respostas da IA, leads (por temperatura), transferências, custo de IA, tudo por período e por empresa.
3. **Caixa de entrada**: conversas em tempo real (Supabase Realtime), filtro "aguardando humano", **responder pelo painel** (com aviso quando a janela de 24h fechar), devolver para a IA.
4. **Empresas e agentes**: os mesmos campos do `tenants/*.json`, com validação, pré-visualização do prompt e medidor do tamanho da base de conhecimento. Reaproveita `tenant-config/` (a mesma validação do CLI).
5. Serviços/produtos, FAQs, base de conhecimento, horários.
6. **Leads/CRM**: lista, filtros, etapas, exportação CSV.
7. **Integrações**: status dos canais (último webhook, último erro), entregas de webhooks, botão "testar".
8. **Planos e consumo**: limites por plano e uso do mês.
9. LGPD: exportar e excluir os dados de um contato, registro de auditoria.

## Fase 4 — Automação

1. **Agendamento** com Google Calendar (API oficial, OAuth por empresa): ferramentas `check_availability`, `book_appointment`, `reschedule`, `cancel`, regras de antecedência e duração vindas do catálogo.
2. **Lembretes** via template de utilidade aprovado (24h e 2h antes), com confirmação por botão.
3. **Follow-ups autorizados** (plano Avançado): regras por evento ("lead quente sem resposta há 24h"), só com consentimento, respeitando opt-out e a janela de 24h.
4. **Templates da Meta**: cadastro, sincronização de status de aprovação e envio.
5. **Áudio**: transcrição (avaliar provedores pelo custo; a Anthropic não transcreve áudio) e **imagens** (o Claude lê imagens).
6. Biblioteca de workflows n8n prontos (planilha, e-mail ao vendedor, RD Station/Pipedrive/HubSpot).

## Fase 5 — Escalabilidade

1. Medir a fila (latência p95, tempo em fila, retentativas) e alertas (Sentry/Better Stack).
2. Separar o worker em fila dedicada (Supabase Queues/pgmq ou SQS) se o volume justificar.
3. RAG com pgvector para bases que excedam o limite do prompt.
4. Particionamento e retenção de `messages`; backups com PITR.
5. Testes de carga e de caos (Meta reenviando, IA lenta, banco instável).
6. Conjunto de avaliação do agente (conversas reais anonimizadas) para comparar modelos, esforço e prompts antes de cada mudança.

## Fase 6 — Comercialização

1. **Embedded Signup da Meta** (programa Tech Provider): o cliente conecta o próprio número em minutos, sem compartilhar acesso manualmente. Exige verificação do negócio e App Review.
2. Assistente de onboarding no painel e modelos por segmento (clínica, salão, imobiliária, academia…).
3. Documentação para clientes, ambiente de demonstração e roteiro de apresentação.
4. **Cobrança**: projetar e validar antes de implementar. Comparar Asaas, Pagar.me, Mercado Pago e Stripe quanto a recorrência com Pix/boleto/cartão, notas fiscais, taxas e webhooks.
5. Contratos: termos de uso, DPA (acordo de tratamento de dados, LGPD) e SLA.

## Próximos passos imediatos (para colocar o MVP no ar)

1. Criar o projeto Supabase e aplicar as migrações → [setup/supabase.md](setup/supabase.md)
2. Criar a chave da Anthropic com limite de gasto → [setup/anthropic.md](setup/anthropic.md)
3. Fazer o deploy na Vercel com as variáveis → [setup/vercel.md](setup/vercel.md)
4. Criar o app na Meta, configurar o webhook e conectar o número de teste → [setup/whatsapp-meta.md](setup/whatsapp-meta.md)
5. Cadastrar a primeira empresa (`npm run tenant:apply`) e calibrar com `npm run chat`
6. (Opcional) n8n para receber leads e transferências → [setup/n8n.md](setup/n8n.md)
