const dinero = (valor: number | string, locale: string, currency: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(valor));

export function dolares(valor: number | string, locale: string) {
  const n = Number(valor);
  return n > 0 && n < 0.005 ? `<${dinero(0.01, locale, "USD")}` : dinero(n, locale, "USD");
}
export function euros(valor: number | string, locale: string) { return dinero(valor, locale, "EUR"); }
export function numero(valor: number | string, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(valor));
}
export function porcentajeSimple(valor: number | string, locale: string, decimales = 0) {
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(Number(valor))}\u00a0%`;
}
export function porcentajeConSigno(valor: number | string, locale: string, decimales = 1) {
  const n = Number(valor);
  const redondeado = Number(Math.abs(n).toFixed(decimales));
  return `${redondeado === 0 ? "" : n < 0 ? "−" : "+"}${porcentajeSimple(Math.abs(n), locale, decimales)}`;
}
export function fechaCorta(iso: string, locale: string) {
  const fecha = new Date(iso);
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const year = soloFecha ? fecha.getUTCFullYear() : fecha.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "short", ...(year !== new Date().getFullYear() ? { year: "numeric" as const } : {}),
    ...(soloFecha ? { timeZone: "UTC" } : {}),
  }).format(fecha);
}
export function fechaHora(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
export function hace(iso: string, locale: string, ahora = new Date()) {
  const segundos = (new Date(iso).getTime() - ahora.getTime()) / 1000;
  const r = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(segundos) < 60) return r.format(0, "second");
  if (Math.abs(segundos) < 3600) return r.format(Math.trunc(segundos / 60), "minute");
  if (Math.abs(segundos) < 86400) return r.format(Math.trunc(segundos / 3600), "hour");
  if (Math.abs(segundos) < 7 * 86400) return r.format(Math.trunc(segundos / 86400), "day");
  return fechaCorta(iso, locale);
}
