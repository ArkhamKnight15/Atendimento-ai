/**
 * Cálculo de horário de funcionamento no fuso do cliente, sem dependências externas.
 * weekday: 0 = domingo … 6 = sábado. Horários no formato "HH:MM" (24h).
 */
export interface BusinessHoursInterval {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface LocalDateTime {
  weekday: number;
  /** Minutos desde a meia-noite local. */
  minutes: number;
  dateLabel: string;
  timeLabel: string;
}

export interface OpenStatus {
  isOpen: boolean;
  /** Quando aberto: horário de fechamento do intervalo atual. */
  closesAt?: string;
  /** Quando fechado: próxima abertura (até 7 dias à frente). */
  nextOpening?: { weekday: number; time: string; inDays: number };
}

export const WEEKDAY_NAMES = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function toMinutes(time: string): number {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!match) throw new Error(`Horário inválido: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatTime(time: string): string {
  return time.slice(0, 5);
}

export function localDateTime(now: Date, timeZone: string): LocalDateTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const weekday = WEEKDAY_INDEX[parts.weekday ?? ""];
  if (weekday === undefined) throw new Error(`Fuso horário inválido: ${timeZone}`);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    weekday,
    minutes: hour * 60 + minute,
    dateLabel: `${parts.day}/${parts.month}/${parts.year}`,
    timeLabel: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

export function getOpenStatus(hours: BusinessHoursInterval[], now: Date, timeZone: string): OpenStatus {
  const local = localDateTime(now, timeZone);
  const byDay = (weekday: number) =>
    hours.filter((h) => h.weekday === weekday).toSorted((a, b) => toMinutes(a.opensAt) - toMinutes(b.opensAt));

  const current = byDay(local.weekday).find(
    (h) => local.minutes >= toMinutes(h.opensAt) && local.minutes < toMinutes(h.closesAt),
  );
  if (current) return { isOpen: true, closesAt: formatTime(current.closesAt) };

  for (let offset = 0; offset <= 7; offset++) {
    const weekday = (local.weekday + offset) % 7;
    const candidates = byDay(weekday).filter((h) => offset > 0 || toMinutes(h.opensAt) > local.minutes);
    const first = candidates[0];
    if (first) return { isOpen: false, nextOpening: { weekday, time: formatTime(first.opensAt), inDays: offset } };
  }
  return { isOpen: false };
}

/** Texto legível dos horários, agrupando dias consecutivos com o mesmo expediente. */
export function describeBusinessHours(hours: BusinessHoursInterval[]): string {
  if (hours.length === 0) return "Horário de funcionamento não informado.";
  const order = [1, 2, 3, 4, 5, 6, 0];
  const signature = (weekday: number) =>
    hours
      .filter((h) => h.weekday === weekday)
      .toSorted((a, b) => toMinutes(a.opensAt) - toMinutes(b.opensAt))
      .map((h) => `${formatTime(h.opensAt)}–${formatTime(h.closesAt)}`)
      .join(" e ");

  const groups: { days: number[]; label: string }[] = [];
  for (const weekday of order) {
    const label = signature(weekday) || "fechado";
    const last = groups.at(-1);
    if (last && last.label === label) last.days.push(weekday);
    else groups.push({ days: [weekday], label });
  }

  return groups
    .map(({ days, label }) => {
      const first = WEEKDAY_NAMES[days[0]!]!;
      const name = days.length === 1 ? first : `${first} a ${WEEKDAY_NAMES[days.at(-1)!]!}`;
      return `- ${name.charAt(0).toUpperCase()}${name.slice(1)}: ${label}`;
    })
    .join("\n");
}

export function describeOpenStatus(status: OpenStatus): string {
  if (status.isOpen) return `ABERTO agora (fecha às ${status.closesAt}).`;
  if (!status.nextOpening) return "FECHADO (sem horário de funcionamento cadastrado).";
  const { inDays, weekday, time } = status.nextOpening;
  const when = inDays === 0 ? "hoje" : inDays === 1 ? "amanhã" : `na ${WEEKDAY_NAMES[weekday]}`;
  return `FECHADO agora. Próxima abertura: ${when} às ${time}.`;
}
