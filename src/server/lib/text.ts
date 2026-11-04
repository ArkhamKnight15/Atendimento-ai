/** Limite de corpo de mensagem de texto da WhatsApp Cloud API. */
export const WHATSAPP_TEXT_LIMIT = 4096;

/** Minúsculas, sem acentos, sem pontuação nas pontas e com espaços colapsados. */
export function normalizeForMatch(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Adapta Markdown comum gerado por LLMs para a formatação do WhatsApp:
 * **negrito** → *negrito*, títulos "# x" → "*x*", listas "* " → "• ".
 */
export function toWhatsAppFormatting(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/^\s*[*-]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Divide textos longos em partes que respeitam o limite, preferindo quebras de parágrafo. */
export function splitMessage(text: string, limit = WHATSAPP_TEXT_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "));
    const index = cut > limit * 0.5 ? cut + 1 : limit;
    parts.push(remaining.slice(0, index).trim());
    remaining = remaining.slice(index).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
