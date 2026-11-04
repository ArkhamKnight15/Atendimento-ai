import { getChannelAccessTokenEnc, recordChannelError } from "../db/context";
import { getPendingOutbound, markOutboundFailed, markOutboundSent } from "../db/conversations";
import type { AgentContext } from "../domain";
import { decryptSecret } from "../lib/crypto";
import type { Logger } from "../lib/logger";
import { WhatsAppApiError, type WhatsAppCredentials } from "../whatsapp/client";
import type { Deps } from "./deps";
import { PermanentError } from "./errors";

export async function getWhatsAppCredentials(deps: Deps, ctx: AgentContext): Promise<WhatsAppCredentials> {
  const tokenEnc = await getChannelAccessTokenEnc(deps.sql, ctx.channel.id);
  if (!tokenEnc) {
    await recordChannelError(deps.sql, ctx.channel.id, "Canal sem token de acesso cadastrado", deps.now(), true);
    throw new PermanentError(`Canal ${ctx.channel.id} sem credenciais`);
  }
  return { phoneNumberId: ctx.channel.externalId, accessToken: decryptSecret(tokenEnc, deps.encryptionKey) };
}

/**
 * Envia as mensagens de saída pendentes da conversa (outbox). Mensagens são
 * gravadas como `pending` ANTES do envio: se a função cair no meio, a próxima
 * tentativa reenvia o texto já gerado em vez de chamar a IA de novo.
 */
export async function flushPendingOutbound(deps: Deps, ctx: AgentContext, log: Logger): Promise<number> {
  const pending = await getPendingOutbound(deps.sql, ctx.tenant.id, ctx.conversation.id);
  if (pending.length === 0) return 0;

  const credentials = await getWhatsAppCredentials(deps, ctx);
  let sent = 0;
  for (const message of pending) {
    try {
      const { externalId } = await deps.whatsapp.sendText(credentials, ctx.contact.externalId, message.content ?? "");
      await markOutboundSent(deps.sql, { tenantId: ctx.tenant.id, id: message.id, externalId, at: deps.now() });
      sent += 1;
    } catch (error) {
      if (!(error instanceof WhatsAppApiError) || error.retryable) throw error;
      await markOutboundFailed(deps.sql, {
        tenantId: ctx.tenant.id,
        id: message.id,
        errorCode: error.code === null ? null : String(error.code),
        errorMessage: error.message,
      });
      if (error.authProblem) {
        await recordChannelError(deps.sql, ctx.channel.id, `Graph API: ${error.message}`, deps.now(), true);
      }
      log.error("envio recusado pela Graph API", { messageId: message.id, code: error.code, error: error.message });
    }
  }
  return sent;
}
