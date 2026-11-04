# 2. Custo estimado de operação por cliente

> Valores de novembro de 2026, com **câmbio assumido de US$ 1 = R$ 5,50**. Os preços da Anthropic vêm da tabela oficial
> de 2026-10. Os de Meta, Supabase, Vercel e OpenAI vêm de fontes públicas que **não puderam ser conferidas na página
> oficial a partir deste ambiente**: confirme nos painéis antes de fechar preço com cliente.

## Premissas de uso (por resposta da IA)

| Item | Valor típico | Observação |
|---|---|---|
| Prefixo em cache (ferramentas + prompt da empresa) | ~4.000 tokens | O exemplo OdontoVita tem ~7.900 caracteres de prompt (≈ 2.500–3.000 tokens com as ferramentas). |
| Histórico + mensagem nova | ~800 tokens | Até 30 mensagens anteriores da conversa. |
| Saída (texto + raciocínio adaptativo) | ~270 tokens | Respostas curtas de WhatsApp, esforço `medium`. |
| Respostas que usam ferramenta | ~30% | Exigem uma segunda chamada, quase toda em cache. |

## Custo de IA por resposta

| Modelo | Entrada / Saída / Leitura de cache (US$ por 1M tokens) | Custo por resposta* | 6.000 respostas/mês |
|---|---|---|---|
| **Claude Haiku 5.5** (padrão) | 0,10 / 0,50 / 0,01 | **US$ 0,0003 – 0,0008** | **US$ 2 – 5 (R$ 11 – 28)** |
| Claude Sonnet 5.5 | 2,00 / 10,00 / 0,20 | US$ 0,006 – 0,015 | US$ 36 – 90 (R$ 200 – 500) |
| Claude Opus 5.5 | 4,00 / 20,00 / 0,20 | US$ 0,012 – 0,03 | US$ 72 – 180 |
| OpenAI GPT-5 mini (referência) | 0,25 / 2,00 / 0,025 | US$ 0,0010 – 0,0016 | US$ 6 – 10 |

\* A faixa menor vale com o cache "quente": a empresa recebe mensagens a intervalos menores que 5 minutos, e o prompt da empresa é compartilhado entre **todas** as conversas dela. A faixa maior vale com o cache "frio", em empresas com pouco movimento.
Para planejar, use **US$ 0,001 por resposta** (com folga). O custo real de cada resposta fica gravado em `agent_runs.cost_usd_micros`.

## WhatsApp (Meta)

A cobrança é **por mensagem**. **Mudança de 1º/10/2026** (relatada por vários provedores; confirme no rate card oficial
dentro do WhatsApp Manager): as respostas dentro da janela de 24h **deixaram de ser totalmente grátis**. Cada número tem
**1.000 mensagens de atendimento grátis por mês**, e o excedente é cobrado pela tarifa de utilidade do país.

| Tipo | Preço aproximado no Brasil | Quando ocorre |
|---|---|---|
| Respostas de atendimento (janela de 24h) | 1.000/mês grátis por número; depois **~US$ 0,0068 (≈ R$ 0,04)** cada | Todo o atendimento do MVP |
| Template de **utilidade** (lembrete, confirmação) | ~R$ 0,04 – 0,08 | Fase 4 |
| Template de **marketing** (follow-up, recuperação) | ~R$ 0,35 – 0,41 | Fase 4 |

Impacto para o cliente com as 2.000 respostas inclusas ≈ **R$ 37/mês** (cada 1.000 a mais ≈ R$ 37).
**No atendimento, o WhatsApp passa a custar mais que a IA.** Por isso o agente responde em
uma única mensagem curta (agrupamento de mensagens + `maxReplyChars`).

**Recomendação comercial:** o cliente cadastra o **próprio cartão na conta WhatsApp Business (WABA)**, e a Meta cobra o uso
direto dele. A Luma não carrega risco financeiro e o contrato deixa explícito que a tarifa da Meta é à parte.

> Política da Meta: desde 2026, a API não permite assistentes de IA de **uso geral**. Agentes de atendimento de uma empresa
> são permitidos. O prompt já restringe o agente ao escopo da empresa (regra 5). Mantenha assim.

## Infraestrutura fixa (compartilhada entre todos os clientes)

| Serviço | Plano | Custo/mês |
|---|---|---|
| Supabase | Pro (inclui US$ 10 de compute = instância Micro), região São Paulo | US$ 25 |
| Vercel | Pro, 1 assento de desenvolvedor (o Hobby não permite uso comercial) | US$ 20 |
| n8n | Self-hosted em VPS pequena (Docker) — ou n8n Cloud Starter (~€ 24) | US$ 6 – 10 |
| Domínio, e-mail, monitoramento básico | — | ~US$ 5 |
| **Total** | | **≈ US$ 56 – 60 (≈ R$ 310 – 330)** |

Ao passar de ~30 clientes ativos, reserve mais ~US$ 15/mês para subir o compute do Supabase (Small).

## Custo de software por cliente (para a Luma; o WhatsApp é pago pelo cliente à Meta)

| Clientes ativos | Infra rateada | IA (até 6 mil respostas/mês) | **Custo por cliente/mês** |
|---|---|---|---|
| 5 | R$ 64 | R$ 11 – 28 | **≈ R$ 75 – 92** |
| 20 | R$ 16 | R$ 11 – 28 | **≈ R$ 27 – 44** |
| 50 | R$ 8 (+ compute) | R$ 11 – 28 | **≈ R$ 21 – 38** |

## Quanto cobrar: um serviço único

A Luma vende **um serviço só**: a IA de atendimento da empresa, nos canais que ela usar (WhatsApp, Instagram e site, sem
custo extra por canal). O que varia entre clientes é o **volume**, e isso é resolvido pelo excedente, não por níveis.

| | Valor |
|---|---|
| **Implantação** (uma vez) | **R$ 697** |
| **Mensalidade** | **R$ 397** |
| Inclui | até 3 canais (WhatsApp, Instagram, site), 2.000 respostas da IA/mês, leads, transferência para humano, avisos ao vendedor, painel (Fase 3) e 1 ajuste de conteúdo/mês |
| Excedente | **R$ 39 a cada 1.000 respostas** acima das 2.000 (a IA não para de atender) |
| WhatsApp (Meta) | pago pelo cliente direto à Meta, no cartão dele |

**Custo para a Luma por cliente** (com 10 clientes): infraestrutura rateada ~R$ 32 + contador rateado ~R$ 20 + IA ~R$ 6–11
+ ~1,5 h de suporte → margem de **~50%** contando o seu tempo, e **> 85%** sem ele. Com 10 clientes: ~R$ 3.970/mês de
faturamento e ~R$ 3.400 de sobra antes de impostos, mais as implantações.

**Por que esse valor:** um atendente CLT custa ~R$ 3–5 mil/mês e só cobre horário comercial; ferramentas "faça você mesmo"
custam ~US$ 50–130/mês sem serviço; plataformas enterprise partem de ~R$ 3 mil/mês. R$ 397 com implantação e acompanhamento
fica acessível para pequenas empresas e acima das ferramentas sem serviço.

**Regras comerciais:**
1. Fidelidade mínima de 6 meses (ou anual com 2 meses grátis).
2. Ajustes de conteúdo além do incluso: cobrados à parte, ou feitos pelo próprio cliente quando o painel liberar a edição.
3. **Clientes fundadores** (os 3 primeiros): 30 dias grátis, implantação pela metade e preço travado por 12 meses, em troca de depoimento.
4. Clientes muito grandes (várias unidades, muitos números): proposta sob medida, a partir do mesmo preço-base.

O "teto de custo IA" (US$ 10/mês por cliente, ~10× o esperado) é só uma trava de segurança contra abuso; abaixo dele a IA nunca para.
