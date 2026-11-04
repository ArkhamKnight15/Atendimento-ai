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

Desde 2025 a cobrança é **por mensagem de template**:

| Tipo | Preço aproximado no Brasil | Quando ocorre |
|---|---|---|
| Respostas dentro da janela de 24h (atendimento) | **Grátis** | Todo o atendimento do MVP |
| Template de **utilidade** (lembrete, confirmação) | ~R$ 0,04 – 0,08 | Fase 4. É grátis se enviado com a janela aberta. |
| Template de **marketing** (follow-up, recuperação) | ~R$ 0,35 – 0,39 | Fase 4 |

**Recomendação comercial:** o cliente cadastra o **próprio cartão na conta WhatsApp Business (WABA)**, e a Meta cobra o uso direto dele. A agência não carrega risco financeiro de disparos.

## Infraestrutura fixa (compartilhada entre todos os clientes)

| Serviço | Plano | Custo/mês |
|---|---|---|
| Supabase | Pro (inclui US$ 10 de compute = instância Micro), região São Paulo | US$ 25 |
| Vercel | Pro, 1 assento de desenvolvedor (o Hobby não permite uso comercial) | US$ 20 |
| n8n | Self-hosted em VPS pequena (Docker) — ou n8n Cloud Starter (~€ 24) | US$ 6 – 10 |
| Domínio, e-mail, monitoramento básico | — | ~US$ 5 |
| **Total** | | **≈ US$ 56 – 60 (≈ R$ 310 – 330)** |

Ao passar de ~30 clientes ativos, reserve mais ~US$ 15/mês para subir o compute do Supabase (Small).

## Custo total por cliente

| Clientes ativos | Infra rateada | IA (Profissional, 6 mil respostas) | **Custo por cliente/mês** |
|---|---|---|---|
| 5 | R$ 64 | R$ 11 – 28 | **≈ R$ 75 – 92** |
| 20 | R$ 16 | R$ 11 – 28 | **≈ R$ 27 – 44** |
| 50 | R$ 8 (+ compute) | R$ 11 – 28 | **≈ R$ 21 – 38** |

## Preços sugeridos (já cadastrados no banco, editáveis)

| Plano | Mensalidade | Implantação | Respostas IA/mês | Teto de custo IA | Margem bruta estimada* |
|---|---|---|---|---|---|
| Básico | R$ 297 | R$ 500 | 2.000 | US$ 5 | > 85% |
| Profissional | R$ 597 | R$ 1.200 | 6.000 | US$ 15 | > 90% |
| Avançado | R$ 1.197 | R$ 2.500 | 15.000 | US$ 40 | > 90% |

\* Sobre custos de software. **O maior custo real é o tempo da equipe** em implantação, ajustes de base de conhecimento e suporte, e é isso que a taxa de implantação deve cobrir.
O "teto de custo IA" é uma trava de segurança (cerca de 5× o esperado), não a previsão de gasto.
