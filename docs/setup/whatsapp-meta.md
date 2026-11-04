# Configuração: WhatsApp Business Platform (Cloud API oficial)

> Os nomes de menus da Meta mudam com frequência. Se algo estiver diferente, procure pelo mesmo conceito na
> documentação oficial: <https://developers.facebook.com/docs/whatsapp/cloud-api/get-started>.

## Visão geral

- **Um app da Meta da agência** recebe os webhooks de **todos** os clientes em uma única URL. O sistema identifica a empresa pelo `phone_number_id`.
- Cada cliente tem a própria **conta WhatsApp Business (WABA)**, com o número e o meio de pagamento dele, dentro do portfólio empresarial dele (ou do da agência, no piloto).
- O token de acesso de cada número fica criptografado no banco (`npm run channel:connect`).

## 1. Conta e app (uma vez, pela agência)

1. Crie (ou use) o **portfólio empresarial** da agência em <https://business.facebook.com> e inicie a **verificação da empresa** (CNPJ). Sem ela, os limites são baixos e não é possível escalar.
2. Em <https://developers.facebook.com/apps>, crie um app do tipo **Business** e adicione o produto **WhatsApp**.
3. Em **App settings → Basic**, copie o **App Secret** → variável `META_APP_SECRET`.

## 2. Webhook

1. Gere um token de verificação: `npm run keys:generate` → `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
2. Faça o deploy (ver [vercel.md](vercel.md)) para ter a URL pública.
3. No app: **WhatsApp → Configuration → Webhook → Edit**
   - Callback URL: `https://SEU-DOMINIO/api/webhooks/whatsapp`
   - Verify token: o valor de `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
   - Clique em **Verify and save**. A Meta faz um `GET` e o sistema responde o `hub.challenge`.
4. Em **Webhook fields**, assine o campo **`messages`** (traz mensagens e status de entrega).

## 3. Número de teste (piloto sem custo)

1. Em **WhatsApp → API Setup**, a Meta oferece um **número de teste** e um token temporário (24h). Cadastre até 5 números de celular de destino para testar.
2. Anote o **Phone number ID** e o **WhatsApp Business Account ID** da tela.

## 4. Token permanente (System User)

O token temporário expira. Para produção:

1. **Business Settings → Users → System users → Add** (papel Admin).
2. **Add assets**: atribua o app e a WABA com controle total.
3. **Generate new token** para o app, com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
4. Guarde o token **somente** pelo comando abaixo (ele não é gravado em texto puro em lugar nenhum).

## 5. Conectar o número a uma empresa

```bash
WHATSAPP_ACCESS_TOKEN='EAAG...' npm run channel:connect -- \
  --tenant odontovita \
  --phone-number-id 123456789012345 \
  --waba-id 987654321098765
```

O script consulta o número na Graph API (nome verificado e qualidade), **inscreve o app nos webhooks da WABA** (`POST /<WABA_ID>/subscribed_apps`), criptografa o token e ativa o canal.

## 6. Número real do cliente

1. Em **WhatsApp → API Setup → Add phone number**, cadastre o número (ele **não pode** estar ativo no app WhatsApp comum ou Business ao mesmo tempo. Avalie a modalidade de *coexistência* da Meta se o cliente precisar manter o app).
2. Aprove o **nome de exibição**, adicione um **meio de pagamento** na WABA (necessário para templates) e rode o `channel:connect` com o novo `phone_number_id`.

## 7. Regras da plataforma que afetam o produto

- **Janela de 24h**: depois da última mensagem do cliente, a empresa pode responder livremente por 24h. Fora dela, **só com template aprovado** (Fase 4).
- **Opt-in**: mensagens iniciadas pela empresa exigem consentimento do cliente. O sistema registra opt-out por "SAIR".
- **Qualidade do número**: bloqueios e denúncias reduzem a qualidade e os limites de envio. A transferência rápida para humano e as respostas sem invenção ajudam a mantê-la alta.
- **Versão da Graph API**: `WHATSAPP_GRAPH_API_VERSION` (padrão `v24.0`). Cada versão tem cerca de 2 anos de suporte. Atualize ao receber o aviso da Meta.

## Teste de ponta a ponta

1. Local: `npm run chat -- --tenant odontovita` (IA real, sem WhatsApp).
2. Deploy: `META_APP_SECRET=... npm run webhook:smoke -- --url https://SEU-DOMINIO/api/webhooks/whatsapp --phone-number-id <id> --from <seu número cadastrado como destino de teste> --text "Oi"`. A resposta chega no seu celular.
3. Real: mande "Oi" do seu celular para o número de teste e acompanhe `public.messages` e `public.agent_runs` no Supabase.
