# Configuração: n8n (automações por cliente)

O n8n **não** está no caminho crítico do atendimento. Ele recebe **eventos** da plataforma e executa as integrações de cada cliente: avisar o vendedor, lançar no CRM, gravar em planilha, mandar e-mail.

## Instalação

- **Self-hosted (menor custo):** VPS pequena com Docker, seguindo o guia oficial (<https://docs.n8n.io/hosting/>), com HTTPS e um domínio (ex.: `n8n.suaagencia.com.br`).
- **n8n Cloud:** mais simples de manter, com custo maior e limite de execuções.
- Licença: o uso interno pela agência para atender os próprios clientes é permitido. Revenda do n8n ou acesso dos seus clientes à sua instância exige outra licença (consulte a *Sustainable Use License*).

## Cadastrar o destino

1. No n8n, crie um workflow com um nó **Webhook** (método POST) e copie a *Production URL*.
2. Cadastre-o na empresa:

```bash
npm run webhook:add -- --tenant odontovita --name n8n \
  --url https://n8n.suaagencia.com.br/webhook/atendimento \
  --events lead.created,lead.hot,conversation.handoff_requested,usage.limit_reached
```

3. Guarde o **segredo de assinatura** exibido (`whsec_...`) numa credencial do n8n.

## Formato dos eventos

```http
POST /webhook/atendimento
Content-Type: application/json
X-Webhook-Id: 0b6f…           # id único do evento (use para ignorar duplicatas)
X-Webhook-Event: lead.created
X-Webhook-Timestamp: 1767225600
X-Webhook-Signature: v1=<hex HMAC-SHA256(segredo, timestamp + "." + corpo bruto)>
```

```json
{
  "id": "0b6f…",
  "type": "lead.created",
  "createdAt": "2026-11-04T15:20:00.000Z",
  "tenant": { "id": "…", "slug": "odontovita" },
  "data": {
    "lead": { "id": "…", "name": "Maria", "phone": "5511…", "interest": "Implantes dentários", "temperature": "hot", "stage": "qualified" },
    "conversationId": "…",
    "whatsappLink": "https://wa.me/5511…"
  }
}
```

| Evento | Quando |
|---|---|
| `lead.created` / `lead.updated` | A IA registrou ou atualizou um lead |
| `lead.hot` | O lead ficou "quente" (uma vez por lead) |
| `conversation.handoff_requested` | Transferência para humano (pedido do cliente, reclamação, falha da IA, limite do plano), com resumo |
| `contact.opted_out` / `contact.opted_in` | Cliente pediu para sair ou voltar a receber mensagens |
| `usage.limit_warning` / `usage.limit_reached` | Empresa chegou a 80% ou 100% do plano no mês |

A entrega é "pelo menos uma vez": em caso de falha (rede, 429, 5xx), há até 8 tentativas com backoff. Use `X-Webhook-Id` para não processar duas vezes.

## Verificar a assinatura no n8n

No nó Webhook, ative **Options → Raw Body**. Em seguida, use um nó **Code** (no self-hosted, defina `NODE_FUNCTION_ALLOW_BUILTIN=crypto` no container do n8n):

```js
const crypto = require('crypto');
const secret = $env.ATENDIMENTO_WEBHOOK_SECRET; // ou uma credencial
const headers = $input.first().json.headers;
const raw = Buffer.from($input.first().binary.data.data, 'base64').toString('utf8');
const timestamp = headers['x-webhook-timestamp'];
const expected = 'v1=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
if (!fresh || expected !== headers['x-webhook-signature']) throw new Error('assinatura inválida');
return [{ json: JSON.parse(raw) }];
```

> Os nomes de campos do Raw Body podem variar entre versões do n8n. Teste uma vez com `npm run webhook:add` apontando
> para o seu workflow e inspecione a execução.

## Workflows sugeridos

1. **Lead quente → vendedor**: `lead.hot` → mensagem no Telegram/Slack/e-mail do vendedor com nome, interesse e `whatsappLink`.
2. **Transferência → equipe**: `conversation.handoff_requested` → aviso com o resumo escrito pela IA.
3. **Leads → planilha/CRM**: `lead.created` → Google Sheets, RD Station, Pipedrive ou HubSpot (nós nativos do n8n).
4. **Consumo → agência**: `usage.limit_warning` → aviso interno para oferecer upgrade de plano.
