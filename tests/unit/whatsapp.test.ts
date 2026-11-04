import { describe, expect, it } from "vitest";
import { GraphWhatsAppClient, WhatsAppApiError } from "../../src/server/whatsapp/client";
import { parseWebhook } from "../../src/server/whatsapp/webhook";
import { inboundPayload, statusPayload, textMessage } from "../helpers/whatsapp-payloads";

describe("parser do webhook", () => {
  it("normaliza mensagens de texto com nome do perfil", () => {
    const parsed = parseWebhook(
      inboundPayload({ phoneNumberId: "111", from: "5511988887777", name: "Maria", messages: [textMessage("Oi, tudo bem?")] }),
    );
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toMatchObject({
      phoneNumberId: "111",
      from: "5511988887777",
      profileName: "Maria",
      type: "text",
      content: "Oi, tudo bem?",
      needsReply: true,
    });
  });

  it("descreve mídias e respostas interativas para o agente", () => {
    const parsed = parseWebhook(
      inboundPayload({
        phoneNumberId: "111",
        from: "5511988887777",
        messages: [
          { type: "audio", audio: { id: "media1", mime_type: "audio/ogg" } },
          { type: "image", image: { id: "media2", caption: "meu dente" } },
          { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "b1", title: "Quero agendar" } } },
          { type: "reaction", reaction: { message_id: "wamid.x", emoji: "👍" } },
        ],
      }),
    );
    const [audio, image, button, reaction] = parsed.messages;
    expect(audio?.content).toContain("áudio");
    expect(image?.content).toContain('Legenda: "meu dente"');
    expect(button?.content).toBe("Quero agendar");
    expect(reaction?.needsReply).toBe(false);
  });

  it("lê atualizações de status com erro", () => {
    const parsed = parseWebhook(
      statusPayload({
        phoneNumberId: "111",
        externalId: "wamid.out.1",
        status: "failed",
        errors: [{ code: 131047, title: "Re-engagement message" }],
      }),
    );
    expect(parsed.statuses[0]).toMatchObject({ status: "failed", errorCode: "131047", errorMessage: "Re-engagement message" });
  });

  it("rejeita envelopes que não são da WhatsApp Cloud API", () => {
    expect(() => parseWebhook({ object: "page", entry: [] })).toThrow(/whatsapp_business_account/);
  });
});

const failing = (status: number, code: number) =>
  new GraphWhatsAppClient("v24.0", (async () => Response.json({ error: { message: "erro", code } }, { status })) as unknown as typeof fetch);

describe("cliente da Graph API", () => {
  const credentials = { phoneNumberId: "111", accessToken: "token" };

  it("envia texto e retorna o wamid", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const client = new GraphWhatsAppClient("v24.0", (async (url: string, init: RequestInit) => {
      request = { url, init };
      return Response.json({ messaging_product: "whatsapp", messages: [{ id: "wamid.ABC" }] });
    }) as unknown as typeof fetch);

    await expect(client.sendText(credentials, "5511988887777", "Olá!")).resolves.toEqual({ externalId: "wamid.ABC" });
    expect(request?.url).toBe("https://graph.facebook.com/v24.0/111/messages");
    expect(JSON.parse(String(request?.init.body))).toMatchObject({
      messaging_product: "whatsapp",
      to: "5511988887777",
      type: "text",
      text: { body: "Olá!" },
    });
    expect((request!.init.headers as Record<string, string>).Authorization).toBe("Bearer token");
  });

  it("classifica erros como retentáveis ou de autenticação", async () => {
    const rate = await failing(400, 130429).sendText(credentials, "1", "x").catch((e: WhatsAppApiError) => e);
    expect(rate).toBeInstanceOf(WhatsAppApiError);
    expect((rate as WhatsAppApiError).retryable).toBe(true);

    const auth = (await failing(401, 190).sendText(credentials, "1", "x").catch((e) => e)) as WhatsAppApiError;
    expect(auth.retryable).toBe(false);
    expect(auth.authProblem).toBe(true);

    const window = (await failing(400, 131047).sendText(credentials, "1", "x").catch((e) => e)) as WhatsAppApiError;
    expect(window.retryable).toBe(false);
    expect(window.authProblem).toBe(false);
  });
});
