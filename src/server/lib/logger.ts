/**
 * Logger estruturado (JSON por linha), compatível com os logs da Vercel.
 * Dados pessoais são mascarados antes de sair do processo (LGPD).
 */
type Level = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

const SENSITIVE_KEYS = /token|secret|password|authorization|api[-_]?key|cookie/i;
const PHONE_KEYS = /^(phone|waId|from|to|recipient|externalContactId)$/i;
const CONTENT_KEYS = /^(content|body|text)$/i;

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return `${digits.slice(0, 4)}****${digits.slice(-2)}`;
}

function redact(value: unknown, key = "", depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (value === null || value === undefined) return value;
  if (SENSITIVE_KEYS.test(key)) return "[redacted]";
  if (typeof value === "string") {
    if (PHONE_KEYS.test(key)) return maskPhone(value);
    if (CONTENT_KEYS.test(key)) return `[${value.length} chars]`;
    return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack?.split("\n").slice(0, 6).join("\n") };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, key, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redact(v, k, depth + 1);
    return out;
  }
  return value;
}

export function createLogger(base: Record<string, unknown> = {}, minLevel?: Level): Logger {
  const threshold = LEVEL_WEIGHT[minLevel ?? ((process.env.LOG_LEVEL as Level | undefined) ?? "info")] ?? 20;

  const write = (level: Level, message: string, fields?: Record<string, unknown>) => {
    if (LEVEL_WEIGHT[level] < threshold) return;
    const line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      msg: message,
      ...(redact({ ...base, ...fields }) as Record<string, unknown>),
    });
    if (level === "error" || level === "warn") console.error(line);
    else process.stdout.write(`${line}\n`);
  };

  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger({ ...base, ...fields }, minLevel),
  };
}

export const logger = createLogger({ service: "atendimento-ai" });

/** Logger silencioso para testes. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
