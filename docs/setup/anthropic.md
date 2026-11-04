# Configuração: Anthropic (Claude)

1. Acesse <https://platform.claude.com>, crie a organização da agência e um **workspace** dedicado à plataforma (ex.: `atendimento-producao`). Faça o mesmo para desenvolvimento.
2. Em **API keys**, crie uma chave no workspace → `ANTHROPIC_API_KEY` (só nas variáveis de ambiente do servidor, nunca no frontend).
3. Em **Limits**, defina um **limite de gasto mensal** do workspace e alertas de e-mail. Ele complementa o teto por empresa que o sistema já aplica (`plans.monthly_ai_budget_usd_micros`).
4. Os limites de taxa (RPM/TPM) crescem com o *usage tier* da organização, conforme o uso e os créditos. Antes de colocar muitos clientes ao mesmo tempo, confira o tier em **Limits**.

## Modelo e esforço

- Padrão: `claude-haiku-5-5` com esforço `medium`, definido por plano (`plans.ai_model`, `plans.ai_effort`) e sobrescrito por agente (`agent.aiModel`, `agent.aiEffort` no JSON).
- Use `claude-sonnet-5-5` só em clientes cujo atendimento seja complexo e cujo preço cubra o custo (~20× maior).
- Antes de trocar o modelo de um cliente, compare as respostas no simulador (`npm run chat`) com conversas reais.

## Como o custo é controlado no código

- O prompt da empresa é idêntico para todas as conversas dela e vai **em cache** (leitura a 10% do preço).
- Dados que mudam a cada mensagem (data/hora, status de abertura, dados do lead) vão numa mensagem de sistema no final da conversa, sem invalidar o cache.
- Cada resposta grava tokens e custo em `agent_runs`. Para verificar o cache, consulte `cache_read_tokens` (deve ser maior que zero a partir da segunda mensagem).
