-- Planos comerciais iniciais. Valores são ponto de partida e podem ser
-- ajustados a qualquer momento (o código lê limites e recursos do banco).
-- Recursos (features) aplicados pelo código hoje: leadQualification.
-- Os demais são aplicados conforme as fases de desenvolvimento avançam.
insert into public.plans
  (code, name, description, monthly_price_cents, setup_price_cents,
   monthly_ai_replies, monthly_ai_budget_usd_micros, max_channels, features, ai_model, ai_effort)
values
  ('basico', 'Básico',
   'Atendimento automatizado, respostas a perguntas frequentes e captação de contatos.',
   49700, 99000, 2000, 5000000, 1,
   '{"faq": true, "leadCapture": true, "leadQualification": false, "scheduling": false, "automations": false, "reports": false, "followUps": false, "customFlows": false}',
   'claude-haiku-5-5', 'medium'),
  ('profissional', 'Profissional',
   'Tudo do Básico + qualificação de leads, agendamentos, integrações com automações, histórico e relatórios.',
   89700, 199000, 6000, 15000000, 1,
   '{"faq": true, "leadCapture": true, "leadQualification": true, "scheduling": true, "automations": true, "reports": true, "followUps": false, "customFlows": false}',
   'claude-haiku-5-5', 'medium'),
  ('avancado', 'Avançado',
   'Tudo do Profissional + fluxos comerciais personalizados, integrações adicionais, follow-ups e gestão avançada.',
   169700, 399000, 15000, 40000000, 3,
   '{"faq": true, "leadCapture": true, "leadQualification": true, "scheduling": true, "automations": true, "reports": true, "followUps": true, "customFlows": true}',
   'claude-haiku-5-5', 'medium')
on conflict (code) do nothing;
