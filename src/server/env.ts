import { z } from "zod";

/**
 * Variáveis de ambiente do servidor, validadas na primeira leitura.
 * A validação é preguiçosa para que `next build` funcione sem segredos;
 * qualquer rota que dependa de uma variável ausente falha com mensagem clara.
 */
const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(16, "use pelo menos 16 caracteres"),
  WHATSAPP_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, "formato esperado: v24.0")
    .default("v24.0"),
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(16, "use pelo menos 16 caracteres"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Janela para agrupar mensagens enviadas em sequência antes de responder. */
  REPLY_DEBOUNCE_MS: z.coerce.number().int().min(0).max(15_000).default(2500),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Leitura pontual para scripts que precisam só de parte das variáveis. */
export function requireEnv(name: keyof ServerEnv): string {
  const value = process.env[name];
  if (!value) throw new Error(`Defina a variável de ambiente ${name}.`);
  return value;
}
