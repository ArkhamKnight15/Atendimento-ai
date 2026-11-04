import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Criptografia de credenciais em repouso (tokens do WhatsApp, segredos de webhooks).
 *
 * Formato: `v1.<iv>.<authTag>.<ciphertext>` (base64url), AES-256-GCM.
 * O prefixo de versão permite rotacionar a chave mestra sem migração destrutiva.
 */
const VERSION = "v1";
const IV_BYTES = 12;

function decodeKey(rawKey: string): Buffer {
  const key = Buffer.from(rawKey, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY deve ser 32 bytes em base64 (gere com `npm run keys:generate`).");
  }
  return key;
}

export function encryptSecret(plaintext: string, rawKey: string): string {
  const key = decodeKey(rawKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, rawKey: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Credencial criptografada em formato desconhecido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", decodeKey(rawKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function generateKey(): string {
  return randomBytes(32).toString("base64");
}

export function hmacSha256Hex(secret: string, data: string | Buffer): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** Comparação em tempo constante para evitar ataques de temporização. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
