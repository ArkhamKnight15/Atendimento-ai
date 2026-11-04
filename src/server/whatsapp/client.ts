/**
 * Cliente da WhatsApp Cloud API (Graph API oficial da Meta).
 * https://developers.facebook.com/docs/whatsapp/cloud-api
 */
export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
}

export interface WhatsAppClient {
  sendText(credentials: WhatsAppCredentials, to: string, body: string): Promise<{ externalId: string }>;
  /** Marca como lida e exibe "digitando…" enquanto a resposta é gerada. */
  markAsRead(credentials: WhatsAppCredentials, messageExternalId: string): Promise<void>;
}

/** Códigos da Graph API que indicam limite de taxa ou falha temporária. */
const RETRYABLE_CODES = new Set([4, 17, 80007, 130429, 131016, 131056, 133004]);
/** Token inválido/expirado ou sem permissão: exige ação humana na conexão do canal. */
const AUTH_CODES = new Set([190, 10, 200, 3]);

export class WhatsAppApiError extends Error {
  readonly code: number | null;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly authProblem: boolean;

  constructor(message: string, httpStatus: number, code: number | null) {
    super(message);
    this.name = "WhatsAppApiError";
    this.httpStatus = httpStatus;
    this.code = code;
    this.retryable = httpStatus >= 500 || httpStatus === 429 || (code !== null && RETRYABLE_CODES.has(code));
    this.authProblem = httpStatus === 401 || (code !== null && AUTH_CODES.has(code));
  }
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_data?: { details?: string } };
}

export class GraphWhatsAppClient implements WhatsAppClient {
  constructor(
    private readonly apiVersion: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = "https://graph.facebook.com",
  ) {}

  private async post(credentials: WhatsAppCredentials, body: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}/${this.apiVersion}/${credentials.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
      const error = (json as GraphErrorBody).error;
      const details = error?.error_data?.details ? ` (${error.error_data.details})` : "";
      throw new WhatsAppApiError(`${error?.message ?? `HTTP ${response.status}`}${details}`, response.status, error?.code ?? null);
    }
    return json;
  }

  async sendText(credentials: WhatsAppCredentials, to: string, body: string) {
    const json = (await this.post(credentials, {
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
    })) as { messages?: { id: string }[] };
    const externalId = json.messages?.[0]?.id;
    if (!externalId) throw new WhatsAppApiError("Resposta da Graph API sem id de mensagem", 502, null);
    return { externalId };
  }

  async markAsRead(credentials: WhatsAppCredentials, messageExternalId: string) {
    await this.post(credentials, {
      status: "read",
      message_id: messageExternalId,
      typing_indicator: { type: "text" },
    });
  }
}
