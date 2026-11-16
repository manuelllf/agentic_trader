import type { Boletin } from "@/lib/blog/admin";

// El boletín y las publicaciones programadas se piensan en hora de España, sea cual sea el reloj del navegador.
const ZONA = "Europe/Madrid";

function partesMadrid(date: Date) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(p => [p.type, p.value]));
}

/** Día y hora de mañana a las 9:00 en España, separados para los dos campos. */
export function mananaMadrid(): { dia: string; hora: string } {
  const p = partesMadrid(new Date());
  const date = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + 1, 9));
  return { dia: date.toISOString().slice(0, 10), hora: "09:00" };
}

/** `AAAA-MM-DDTHH:MM` en hora de España a instante; `null` si no existe (salto de hora) o no es válido. */
export function fechaMadrid(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const wall = new Date(`${value}:00Z`).getTime();
  if (!Number.isFinite(wall)) return null;
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const p = partesMadrid(new Date(instant));
    const represented = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    instant += wall - represented;
  }
  const p = partesMadrid(new Date(instant));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === value ? new Date(instant) : null;
}

export function fechaHoraMadrid(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: ZONA, dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function totalSuscriptores(datos: Boletin, estado: string, idioma?: string): number {
  return datos.suscriptores.filter(s => s.estado === estado && (!idioma || s.idioma === idioma)).reduce((n, s) => n + s.total, 0);
}
