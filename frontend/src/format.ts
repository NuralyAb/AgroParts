const nf = new Intl.NumberFormat("ru-RU");

export const money = (n: number | null | undefined) => (n == null ? "—" : `${nf.format(n)} ₸`);

/** Backend отдаёт naive UTC без суффикса зоны. */
export function parseDate(s: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
}

export const dateTime = (s: string | null | undefined) =>
  s ? parseDate(s).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export function ago(s: string | null | undefined): string {
  if (!s) return "—";
  const min = Math.round((Date.now() - parseDate(s).getTime()) / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}

export function until(s: string | null | undefined): string | null {
  if (!s) return null;
  const min = Math.round((parseDate(s).getTime() - Date.now()) / 60000);
  if (min <= 0) return "истекает";
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} ч ${min % 60} мин` : `${Math.floor(h / 24)} дн`;
}

export const pcs = (n: number) => `${nf.format(n)} шт.`;

export const yearsText = (from: number | null, to: number | null) =>
  from || to ? `${from ?? "…"}–${to ?? "н.в."}` : "";
