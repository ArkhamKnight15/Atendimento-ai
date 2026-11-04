# 6. Segurança, confiabilidade e LGPD

## Controles implementados

| Requisito | Como está atendido |
|---|---|
| Proteção de credenciais | Tokens do WhatsApp e segredos de webhook criptografados com AES-256-GCM (`CREDENTIALS_ENCRYPTION_KEY`), guardados no schema `private`, nunca enviados ao navegador nem gravados em log. O formato tem prefixo de versão (`v1.`) para permitir rotação de chave; o script de recriptografia ainda não existe (Fase 5). |
| Variáveis de ambiente | Validadas com Zod na primeira leitura ([`src/server/env.ts`](../src/server/env.ts)). Documentadas em [`.env.example`](../.env.example). Nenhum segredo no repositório. |
| Controle de acesso | RLS em todas as tabelas expostas. Papéis por empresa (owner/admin/agent/viewer) + administradores da plataforma. Canais e webhooks só são alterados pela agência. Anônimos não têm acesso. |
| Isolamento entre empresas | `tenant_id` + FKs compostas + RLS + ferramentas escopadas pelo servidor (ver [arquitetura](01-arquitetura.md#isolamento-entre-empresas)). Coberto por testes. |
| Validação de entradas | Assinatura HMAC da Meta sobre o corpo bruto, parser Zod do webhook, validação Zod dos argumentos das ferramentas da IA (além do `strict: true`), configuração de empresa validada, URLs de webhook só HTTPS públicas (anti-SSRF). |
| Tratamento de erros | Erros classificados (transitório × definitivo). Retentativas com backoff. O cliente nunca fica sem resposta (contingência + transferência). |
| Logs de execução | JSON estruturado com telefone mascarado, conteúdo de mensagens omitido e chaves sensíveis removidas. `agent_runs` registra cada resposta da IA. |
| Duplicidade de mensagens | Índice único por `wamid` + verificação na transação. |
| Limite de requisições | Por contato (10/min, 150/dia), por empresa (teto mensal de custo de IA) e por resposta (até 4 iterações de ferramenta). |
| Webhook e cron | `/api/webhooks/whatsapp` só aceita assinatura válida. `/api/cron/jobs` exige `Authorization: Bearer CRON_SECRET`. |
| Backup e recuperação | Supabase Pro faz backup diário. Recomendado ativar **PITR** quando houver clientes pagantes. As migrações versionadas recriam o esquema. O outbox e a fila garantem que nada se perde se uma função cair. |

## LGPD — papéis e obrigações

- **A empresa cliente é a controladora** dos dados dos clientes dela. **A agência é operadora.** Formalize isso num **DPA** (acordo de tratamento de dados) anexo ao contrato.
- **Suboperadores** a declarar: Meta (WhatsApp), Anthropic (IA, processamento nos EUA: **transferência internacional**, art. 33, coberta por cláusulas contratuais), Supabase (banco, região São Paulo), Vercel (hospedagem, região São Paulo) e o provedor do n8n.
- **Minimização**: o agente pede só nome e, quando necessário, e-mail. É instruído a nunca pedir documentos, senhas ou dados de cartão.
- **Transparência**: aviso de privacidade com link na primeira resposta (`tenants.privacy_policy_url`). O agente confirma que é uma IA quando perguntado.
- **Comunicações comerciais**: "SAIR" registra `marketing_opt_out_at` e "QUERO RECEBER" desfaz. Os follow-ups da Fase 4 **não serão enviados** a quem fez opt-out. A Meta também exige opt-in para mensagens iniciadas pela empresa.
- **Direitos do titular** (acesso, correção, exclusão): hoje via SQL pela agência. Exportação e exclusão pelo painel na Fase 3.
- **Retenção**: definir com cada cliente (sugestão: mensagens por 12 meses, leads enquanto houver relação comercial). O job de expurgo entra na Fase 5.
- **Dados sensíveis** (saúde, por exemplo, em clínicas): o agente não pede nem aprofunda. Se o cliente relatar, a conversa é transferida (gatilho configurável). Avalie com o jurídico do cliente.

## Boas práticas operacionais

1. Use **um token de System User** por WABA (não o token temporário de 24h) e guarde-o só pelo `channel:connect`.
2. Configure **limite de gasto** no console da Anthropic e alertas de uso.
3. Rotacione `CRON_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` e o App Secret se houver suspeita de vazamento.
4. Use ambientes separados (Supabase/Vercel) para desenvolvimento e produção. O simulador e os testes nunca devem apontar para produção.
