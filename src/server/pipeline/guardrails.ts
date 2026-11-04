import type { AgentContext } from "../domain";
import { normalizeForMatch } from "../lib/text";

/** Anti-abuso por contato: acima disso a IA deixa de responder (mensagens continuam salvas). */
export const RATE_LIMITS = {
  perMinute: 10,
  perDay: 150,
} as const;

/** Percentual do limite mensal que dispara o aviso para a agência. */
export const USAGE_WARNING_RATIO = 0.8;

const OPT_OUT = new Set([
  "sair",
  "parar",
  "pare",
  "stop",
  "descadastrar",
  "cancelar inscricao",
  "remover meu numero",
  "nao quero receber",
  "nao quero mais receber",
  "nao quero receber mensagens",
  "nao quero mais receber mensagens",
]);

const OPT_IN = new Set(["quero receber", "voltar a receber", "aceito receber", "start"]);

/**
 * Palavras-chave de consentimento (LGPD). Só valem quando a mensagem inteira é a
 * palavra-chave, para não confundir "quero sair às 18h" com um descadastro.
 */
export function detectConsentKeyword(text: string | null): "opt_out" | "opt_in" | null {
  if (!text) return null;
  const normalized = normalizeForMatch(text);
  if (OPT_OUT.has(normalized)) return "opt_out";
  if (OPT_IN.has(normalized)) return "opt_in";
  return null;
}

export function optOutConfirmation(tenantName: string): string {
  return `Pronto! Você não vai mais receber mensagens promocionais da ${tenantName}. Se precisar de algo, é só escrever por aqui. Para voltar a receber novidades, envie QUERO RECEBER.`;
}

export function optInConfirmation(tenantName: string): string {
  return `Combinado! Você voltará a receber novidades da ${tenantName}. Para parar quando quiser, envie SAIR.`;
}

export function privacyNotice(url: string): string {
  return `_Seus dados são tratados conforme nossa Política de Privacidade: ${url}. Para não receber mensagens promocionais, envie SAIR._`;
}

/** A IA só responde quando empresa, canal e agente estão habilitados. */
export function automationEnabled(ctx: AgentContext): { enabled: boolean; reason?: string } {
  if (ctx.tenant.status !== "active" && ctx.tenant.status !== "onboarding") {
    return { enabled: false, reason: `empresa ${ctx.tenant.status}` };
  }
  if (ctx.channel.status !== "active") return { enabled: false, reason: `canal ${ctx.channel.status}` };
  if (!ctx.agent.isActive) return { enabled: false, reason: "agente desativado" };
  return { enabled: true };
}
