import { describe, expect, it } from "vitest";
import { costUsdMicros } from "../../src/server/ai/pricing";
import { describeBusinessHours, describeOpenStatus, getOpenStatus } from "../../src/server/lib/business-hours";
import { decryptSecret, encryptSecret, generateKey, hmacSha256Hex } from "../../src/server/lib/crypto";
import { maskPhone } from "../../src/server/lib/logger";
import { normalizeForMatch, splitMessage, toWhatsAppFormatting } from "../../src/server/lib/text";
import { detectConsentKeyword } from "../../src/server/pipeline/guardrails";
import { signWebhook } from "../../src/server/pipeline/deliver-event";
import { usagePeriod } from "../../src/server/db/usage";
import { parseTenantConfig } from "../../src/server/tenant-config/schema";
import { assertPublicHttpsUrl } from "../../src/server/tenant-config/webhooks";
import { verifyMetaSignature } from "../../src/server/whatsapp/signature";

const TZ = "America/Sao_Paulo";
const hours = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: "08:00", closesAt: "12:00" })),
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: "13:00", closesAt: "18:00" })),
  { weekday: 6, opensAt: "09:00", closesAt: "13:00" },
];

describe("horário de funcionamento", () => {
  it("considera o fuso da empresa e os intervalos do dia", () => {
    // 2026-11-04 é quarta-feira. 13:30Z = 10:30 em São Paulo.
    expect(getOpenStatus(hours, new Date("2026-11-04T13:30:00Z"), TZ)).toEqual({ isOpen: true, closesAt: "12:00" });
    // 15:30Z = 12:30 (almoço) → reabre hoje às 13:00
    expect(getOpenStatus(hours, new Date("2026-11-04T15:30:00Z"), TZ)).toEqual({
      isOpen: false,
      nextOpening: { weekday: 3, time: "13:00", inDays: 0 },
    });
  });

  it("encontra a próxima abertura atravessando o fim de semana", () => {
    // Sábado 2026-11-07 17:00Z = 14:00 local (fechado) → segunda às 08:00
    const status = getOpenStatus(hours, new Date("2026-11-07T17:00:00Z"), TZ);
    expect(status).toEqual({ isOpen: false, nextOpening: { weekday: 1, time: "08:00", inDays: 2 } });
    expect(describeOpenStatus(status)).toBe("FECHADO agora. Próxima abertura: na segunda-feira às 08:00.");
  });

  it("agrupa dias com o mesmo expediente", () => {
    expect(describeBusinessHours(hours)).toBe(
      "- Segunda-feira a sexta-feira: 08:00–12:00 e 13:00–18:00\n- Sábado: 09:00–13:00\n- Domingo: fechado",
    );
  });

  it("calcula o período de consumo no fuso da empresa", () => {
    // 2026-12-01 01:00Z ainda é 30/11 em São Paulo
    expect(usagePeriod(new Date("2026-12-01T01:00:00Z"), TZ)).toBe("2026-11-01");
  });
});

describe("texto", () => {
  it("normaliza acentos, caixa e pontuação", () => {
    expect(normalizeForMatch("  Não quero MAIS receber!! ")).toBe("nao quero mais receber");
  });

  it("converte Markdown comum para a formatação do WhatsApp", () => {
    expect(toWhatsAppFormatting("## Horários\n**Seg a sex**: 8h\n- item\n\n\n\nfim")).toBe(
      "*Horários*\n*Seg a sex*: 8h\n• item\n\nfim",
    );
  });

  it("divide mensagens longas respeitando o limite", () => {
    const parts = splitMessage(`${"a".repeat(3000)}\n\n${"b".repeat(3000)}`, 4096);
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
  });

  it("mascara telefones em logs", () => {
    expect(maskPhone("5511987654321")).toBe("5511****21");
  });
});

describe("consentimento (LGPD)", () => {
  it("reconhece descadastro apenas com a mensagem inteira", () => {
    expect(detectConsentKeyword("SAIR")).toBe("opt_out");
    expect(detectConsentKeyword("Não quero mais receber mensagens.")).toBe("opt_out");
    expect(detectConsentKeyword("quero receber")).toBe("opt_in");
    expect(detectConsentKeyword("posso sair às 18h?")).toBeNull();
    expect(detectConsentKeyword("quero cancelar minha consulta")).toBeNull();
  });
});

describe("criptografia e assinaturas", () => {
  it("criptografa e descriptografa credenciais", () => {
    const key = generateKey();
    const enc = encryptSecret("EAAG-token-secreto", key);
    expect(enc).not.toContain("EAAG");
    expect(decryptSecret(enc, key)).toBe("EAAG-token-secreto");
  });

  it("detecta adulteração e chave errada", () => {
    const key = generateKey();
    const enc = encryptSecret("segredo", key);
    const tampered = `${enc.slice(0, -2)}${enc.endsWith("A") ? "B" : "A"}A`;
    expect(() => decryptSecret(tampered, key)).toThrow(/authenticate/);
    expect(() => decryptSecret(enc, generateKey())).toThrow(/authenticate/);
  });

  it("valida a assinatura X-Hub-Signature-256 da Meta sobre o corpo bruto", () => {
    const body = Buffer.from('{"object":"whatsapp_business_account","entry":[{"x":"ação"}]}');
    const header = `sha256=${hmacSha256Hex("app-secret", body)}`;
    expect(verifyMetaSignature(body, header, "app-secret")).toBe(true);
    expect(verifyMetaSignature(body, header, "outro-secret")).toBe(false);
    expect(verifyMetaSignature(Buffer.from(`${body} `), header, "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, null, "app-secret")).toBe(false);
  });

  it("assina webhooks de saída com timestamp", () => {
    expect(signWebhook("s", 1700000000, "{}")).toBe(`v1=${hmacSha256Hex("s", "1700000000.{}")}`);
  });
});

describe("custos de IA", () => {
  it("calcula micro-dólares com cache", () => {
    // Haiku 5.5: 300×0,10 + 80×0,50 + 2500×0,01 = 30 + 40 + 25
    expect(costUsdMicros("claude-haiku-5-5", { inputTokens: 300, outputTokens: 80, cacheReadTokens: 2500, cacheWriteTokens: 0 })).toBe(95);
  });

  it("aplica a tabela de prompt longo do Haiku acima de 100 mil tokens", () => {
    const usage = { inputTokens: 120_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costUsdMicros("claude-haiku-5-5", usage)).toBe(60_000);
  });
});

const base = {
  slug: "loja-teste",
  name: "Loja Teste",
  plan: "basico",
  agent: { name: "Ana", tone: "simpático", handoffMessage: "Vou chamar a equipe.", fallbackMessage: "Tive um problema." },
};
const invalidConfig = {
  ...base,
  slug: "Loja Teste",
  catalog: [{ name: "Corte", priceType: "fixed" }],
  businessHours: [{ days: [1], opensAt: "18:00", closesAt: "08:00" }],
};

const parseInvalid = () => parseTenantConfig(invalidConfig);

describe("configuração de empresa", () => {

  it("aceita a configuração mínima com padrões", () => {
    const config = parseTenantConfig(base);
    expect(config.timezone).toBe("America/Sao_Paulo");
    expect(config.agent.maxReplyChars).toBe(700);
  });

  it("explica os erros de validação", () => {
    expect(parseInvalid).toThrow(/- slug: use letras minúsculas/);
    expect(parseInvalid).toThrow(/- catalog\.0: informe price/);
    expect(parseInvalid).toThrow(/- businessHours\.0: closesAt deve ser depois de opensAt/);
  });

  it("rejeita itens de catálogo duplicados", () => {
    expect(() =>
      parseTenantConfig({ ...base, catalog: [{ name: "A", price: 1 }, { name: "A", price: 2 }] }),
    ).toThrow(/duplicado/);
  });
});

describe("proteção contra SSRF em webhooks", () => {
  it.each(["http://n8n.exemplo.com", "https://localhost/x", "https://10.0.0.5/x", "https://169.254.169.254/x", "https://[::1]/x", "https://n8n.internal/x"])(
    "bloqueia %s",
    (url) => expect(() => assertPublicHttpsUrl(url)).toThrow(/HTTPS|internos/),
  );

  it("aceita URL pública HTTPS", () => {
    expect(assertPublicHttpsUrl("https://n8n.agencia.com.br/webhook/abc").hostname).toBe("n8n.agencia.com.br");
  });
});
