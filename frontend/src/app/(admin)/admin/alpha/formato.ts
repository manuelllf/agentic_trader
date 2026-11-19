import { dolares, fechaCorta, porcentajeConSigno, porcentajeSimple } from "../_marco/formato";

const ZONA = "America/New_York";
const ZONA_ES = "Europe/Madrid";

export const aNumero = (v: string | number | null | undefined): number => Number(v ?? 0);

export const dinero = (v: string | number, locale: string) => dolares(aNumero(v), locale);

/** Las razones llegan como fracción (0,05 = 5 %). */
export const razon = (v: string | number, locale: string, decimales = 1) => porcentajeConSigno(aNumero(v) * 100, locale, decimales);

/** Un peso (0,3 = 30 %) sin signo. */
export const peso = (v: string | number, locale: string, decimales = 1) => porcentajeSimple(aNumero(v) * 100, locale, decimales);

/** Clase de color solo para cifras de ganar y perder; el cero queda neutro. */
export const tonoDe = (v: string | number): "pa-bien" | "pa-mal" | "" => {
  const n = Number(aNumero(v).toFixed(4));
  return n > 0 ? "pa-bien" : n < 0 ? "pa-mal" : "";
};

export const fecha = (iso: string, locale: string) => fechaCorta(iso, locale);

const formatoHora = (zona: string, locale: string, segundos: boolean) =>
  new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", ...(segundos ? { second: "2-digit" } : {}), timeZone: zona });

/** Hora de Nueva York: el agente trabaja siempre con ella. */
export const horaNY = (iso: string, locale: string, segundos = false) => formatoHora(ZONA, locale, segundos).format(new Date(iso));

/** Hora de Madrid del mismo instante. La diferencia con Nueva York es de 5 o 6 horas según la fecha. */
export const horaES = (iso: string, locale: string, segundos = false) => formatoHora(ZONA_ES, locale, segundos).format(new Date(iso));

/** Nombres de las dos zonas: son los mismos en todos los idiomas. */
export const ZONA_NY_ETIQUETA = "NY";
export const ZONA_ES_ETIQUETA = "Madrid";

/** «09:35 NY · 15:35 Madrid», para frases y para la imagen de compartir. */
export const horasNYyES = (iso: string, locale: string) =>
  `${horaNY(iso, locale)} ${ZONA_NY_ETIQUETA} · ${horaES(iso, locale)} ${ZONA_ES_ETIQUETA}`;

export const diaHoraNY = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: ZONA }).format(new Date(iso));

export type Bloque =
  | { tipo: "titulo"; nivel: 1 | 2; texto: string }
  | { tipo: "parrafo"; texto: string }
  | { tipo: "lista"; items: string[] };

/** El agente escribe en markdown sencillo: títulos, listas y párrafos. Se lee como bloques para
 *  pintarlos como texto de la app, nunca como HTML. */
export function bloques(texto: string): Bloque[] {
  const out: Bloque[] = [];
  let parrafo: string[] = [];
  let lista: string[] | null = null;
  const cerrar = () => {
    if (parrafo.length) out.push({ tipo: "parrafo", texto: parrafo.join(" ") });
    if (lista) out.push({ tipo: "lista", items: lista });
    parrafo = [];
    lista = null;
  };
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trim();
    const titulo = /^(#{1,6})\s+(.+)$/.exec(linea);
    const item = /^(?:[-*•]|\d+[.)])\s+(.+)$/.exec(linea);
    if (!linea) cerrar();
    else if (titulo) {
      cerrar();
      out.push({ tipo: "titulo", nivel: titulo[1].length === 1 ? 1 : 2, texto: titulo[2] });
    } else if (item) {
      if (parrafo.length) cerrar();
      (lista ??= []).push(item[1]);
    } else if (lista && /^\s/.test(cruda)) {
      // Una línea sangrada tras un punto lo continúa; sin sangría empieza un párrafo nuevo.
      lista[lista.length - 1] += ` ${linea}`;
    } else {
      if (lista) cerrar();
      parrafo.push(linea);
    }
  }
  cerrar();
  return out;
}

/** Trozos de una línea: los impares van en negrita (`**así**`). */
export const negritas = (texto: string): string[] => texto.split(/\*\*(.+?)\*\*/g);

/** Un código como `orden_rechazada` se lee como «orden rechazada». */
export const legible = (codigo: string) => codigo.replace(/_/g, " ");
