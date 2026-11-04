import { hmacSha256Hex, safeEqual } from "../lib/crypto";

/**
 * Valida o cabeçalho `X-Hub-Signature-256` enviado pela Meta:
 * `sha256=<HMAC-SHA256 do corpo bruto com o App Secret>`.
 * O HMAC precisa ser calculado sobre os bytes exatos recebidos.
 */
export function verifyMetaSignature(rawBody: Buffer, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = `sha256=${hmacSha256Hex(appSecret, rawBody)}`;
  return safeEqual(expected, header.trim());
}
