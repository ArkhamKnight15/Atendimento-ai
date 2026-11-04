# Configuração: Vercel

1. Plano **Pro** (o Hobby é só para uso pessoal e não comercial).
2. **Add New → Project** → importe o repositório `Atendimento-ai`. O framework (Next.js) é detectado automaticamente.
3. **Settings → Environment Variables** (Production; e Preview com um banco separado). Gere os segredos com `npm run keys:generate`:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | Supabase **Transaction pooler** (porta 6543) |
| `ANTHROPIC_API_KEY` | chave do workspace de produção |
| `META_APP_SECRET` | App Secret do app da Meta |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | o mesmo configurado no webhook da Meta |
| `WHATSAPP_GRAPH_API_VERSION` | `v24.0` (ou a versão vigente) |
| `CREDENTIALS_ENCRYPTION_KEY` | 32 bytes em base64 — **a mesma usada no `channel:connect`** |
| `CRON_SECRET` | segredo aleatório (a Vercel envia no cabeçalho do cron) |
| `REPLY_DEBOUNCE_MS` | `2500` (opcional) |

4. A região das funções é **gru1 (São Paulo)**, definida em [`vercel.json`](../../vercel.json), perto do Supabase sa-east-1.
5. O **cron** (`/api/cron/jobs` a cada minuto) é registrado automaticamente pelo `vercel.json`. Confira em **Settings → Cron Jobs**.
6. **Domínio**: configure um domínio próprio (ex.: `api.suaagencia.com.br`) e use-o na URL de callback da Meta.
7. **Deployment Protection**: deixe a proteção desligada no domínio de **produção**, ou a Meta não consegue entregar os webhooks. Nos previews ela pode ficar ligada.
8. Depois do deploy: `curl https://SEU-DOMINIO/api/health` → `{"status":"ok","database":"ok"}`.

## Observações

- O webhook responde à Meta assim que grava a mensagem. A IA roda em seguida, em `after()`, na mesma função (até 60 s).
- Logs: **Project → Logs**. São JSON com telefone mascarado e sem o conteúdo das mensagens. Filtre por `"level":"error"`.
- **Chave de criptografia**: trocar `CREDENTIALS_ENCRYPTION_KEY` sem recriptografar os tokens desativa todos os canais. Guarde-a num cofre de senhas.
