-- Serviço único da Luma. A tabela de planos continua existindo para guardar
-- preço, respostas inclusas, teto de custo e recursos num só lugar (e permitir
-- condições especiais por cliente via tenants.limits_override).
--
-- monthly_ai_replies = respostas inclusas no mês (acima disso a IA continua
--   atendendo e o excedente é cobrado);
-- monthly_ai_budget_usd_micros = trava de segurança de custo de IA (aí sim pausa).
insert into public.plans
  (code, name, description, monthly_price_cents, setup_price_cents,
   monthly_ai_replies, monthly_ai_budget_usd_micros, max_channels, features, ai_model, ai_effort)
values
  ('luma', 'Luma Atendimento',
   'IA de atendimento para WhatsApp, Instagram e site: atende 24h com base nas informações da empresa, capta e qualifica leads, transfere para humano e integra com automações.',
   39700, 69700, 2000, 10000000, 3, -- 3 canais: WhatsApp, Instagram e site
   '{"faq": true, "leadCapture": true, "leadQualification": true, "scheduling": true, "automations": true, "reports": true, "followUps": true, "customFlows": true}',
   'claude-haiku-5-5', 'medium')
on conflict (code) do nothing;
