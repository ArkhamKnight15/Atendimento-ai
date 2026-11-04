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

Impacto com o plano usado até o limite: Básico (2.000 respostas) ≈ **R$ 37/mês**, Profissional (6.000) ≈ **R$ 187/mês**,
Avançado (15.000) ≈ **R$ 520/mês**. **No atendimento, o WhatsApp passa a custar mais que a IA.** Por isso o agente responde em
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

| Clientes ativos | Infra rateada | IA (Profissional, 6 mil respostas) | **Custo por cliente/mês** |
|---|---|---|---|
| 5 | R$ 64 | R$ 11 – 28 | **≈ R$ 75 – 92** |
| 20 | R$ 16 | R$ 11 – 28 | **≈ R$ 27 – 44** |
| 50 | R$ 8 (+ compute) | R$ 11 – 28 | **≈ R$ 21 – 38** |

## Quanto cobrar (preços recomendados, já cadastrados no banco e editáveis)

| Plano | Implantação | Mensalidade | Respostas IA/mês | Custo Luma/mês* | Margem* |
|---|---|---|---|---|---|
| Básico | R$ 990 | **R$ 497** | 2.000 | ≈ R$ 190 | ~60% |
| Profissional | R$ 1.990 | **R$ 897** | 6.000 | ≈ R$ 360 | ~60% |
| Avançado | a partir de R$ 3.990 | **a partir de R$ 1.697** | 15.000 | ≈ R$ 720 | ~58% |

\* Com 20 clientes: infraestrutura rateada + IA no limite do plano + **tempo da equipe** (2 h/mês no Básico, 4 h no
Profissional e 8 h no Avançado, a R$ 80/h). Sem contar o tempo da equipe, a margem de software passa de 90%. O WhatsApp
**não entra**, porque é cobrado pela Meta direto no cartão do cliente.

**Por que esses valores:**
- **Âncora de valor:** um atendente CLT custa ~R$ 3–5 mil/mês com encargos e cobre só o horário comercial. O agente atende
  24h e capta leads fora do expediente. A mensalidade fica entre 10% e 30% desse custo, um argumento fácil de vender.
- **Mercado:** ferramentas "faça você mesmo" custam ~US$ 50–130/mês, sem implantação nem acompanhamento; plataformas
  enterprise partem de ~R$ 3 mil/mês; projetos sob medida custam R$ 8–20 mil. A Luma vende serviço completo: precisa ficar
  acima das ferramentas e bem abaixo do enterprise.
- **Implantação** cobre de 8 a 40 h de trabalho (levantamento, base de conhecimento, calibração no simulador, conexão do número).

**Regras comerciais recomendadas:**
1. Tarifas da Meta cobradas direto no cartão do cliente (na WABA dele).
2. Excedente: **R$ 59 a cada 1.000 respostas** além do plano (o custo de IA é ~R$ 5,50).
3. Fidelidade mínima de 6 meses, ou pagamento anual com 2 meses grátis.
4. **Clientes fundadores** (os 3 primeiros): 50% de desconto na implantação em troca de depoimento e estudo de caso.
5. Venda só o que já existe: hoje, Básico completo e Profissional **sem** agendamento e relatórios no painel (Fases 3 e 4).
   Até lá, ofereça o Profissional com desconto de fundador e deixe claras as datas.

O "teto de custo IA" do plano é uma trava de segurança (cerca de 5× o esperado), não a previsão de gasto.
