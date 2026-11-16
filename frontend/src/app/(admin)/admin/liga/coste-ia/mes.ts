/** Mes `AAAA-MM` desplazado `delta` meses (puede cruzar de año). */
export function moverMes(mes: string, delta: number): string {
  const [anio, numero] = mes.split("-").map(Number);
  const f = new Date(Date.UTC(anio, numero - 1 + delta, 1));
  return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const mesActual = () => new Date().toISOString().slice(0, 7);

export function nombreMes(mes: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mes}-01T00:00:00Z`));
}
