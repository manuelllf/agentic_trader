// Formato de números y fechas de la liguilla, en español (DESIGN.md §10). Puerto de las
// funciones `sign`/`pct`/`eur`/`num`/`dec` de docs/maqueta-liguilla-b.html a TypeScript tipado.

const MENOS = "−"; // signo menos tipográfico, no el guion ASCII
const ESPACIO_DURO = " ";

/**
 * Redondea al alza en magnitud (ROUND_HALF_UP sobre el valor absoluto), no al par más
 * cercano: 0,55 → 0,6 y −0,05 → −0,1. `toPrecision` limpia antes el ruido de la coma
 * flotante (0.55 se guarda como 0.550000000000000044...) para que los empates no bajen.
 */
function redondeoMedioArriba(valor: number, decimales: number): number {
  if (!Number.isFinite(valor)) return valor;
  const factor = 10 ** decimales;
  const escalado = Number((Math.abs(valor) * factor).toPrecision(12));
  const entero = Math.round(escalado);
  return valor < 0 && entero !== 0 ? -entero / factor : entero / factor;
}

/** Clase semántica de color para un valor con signo: nunca es el único indicio (el signo
 * y el "0,0" siempre acompañan), pero sirve para pintar `.up`/`.dn`/`.fl`. */
export function claseSigno(valor: number, decimales = 1): "up" | "dn" | "fl" {
  const r = redondeoMedioArriba(valor, decimales);
  return r > 0 ? "up" : r < 0 ? "dn" : "fl";
}

/** Número con signo explícito, coma decimal y el menos tipográfico. El cero no lleva signo. */
export function signo(valor: number, decimales = 1): string {
  const r = redondeoMedioArriba(valor, decimales);
  const texto = Math.abs(r).toFixed(decimales).replace(".", ",");
  if (r === 0) return texto;
  return (r > 0 ? "+" : MENOS) + texto;
}

/** Porcentaje con signo, 1 decimal por defecto y espacio duro antes de «%» (DESIGN.md §10). */
export function porcentaje(valor: number, decimales = 1): string {
  return signo(valor, decimales) + ESPACIO_DURO + "%";
}

/**
 * Diferencia en puntos porcentuales (p. ej. «vs S&P»). Se formatea igual que un porcentaje
 * con «%»: el glosario prohíbe escribir la abreviatura «p. p.» en la interfaz (DESIGN.md §10).
 */
export const diferenciaPuntos = porcentaje;

/** Euros con 2 decimales, coma decimal y espacio duro antes de «€». Sin signo «+»: los
 * créditos son siempre un saldo, no una variación (a diferencia de los porcentajes). */
export function euros(valor: number, decimales = 2): string {
  const r = redondeoMedioArriba(valor, decimales);
  const texto = Math.abs(r).toFixed(decimales).replace(".", ",");
  return (r < 0 ? MENOS : "") + texto + ESPACIO_DURO + "€";
}

/** Miles con punto separador, sin decimales (recuento de empresas, posiciones en la tabla...). */
export function miles(valor: number): string {
  const negativo = valor < 0;
  const texto = Math.trunc(Math.abs(valor))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return negativo ? MENOS + texto : texto;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

/** Nombre de mes en español a partir de un índice 0-11 (admite fuera de rango, como los meses). */
export function nombreMes(indice: number): string {
  return MESES[((indice % 12) + 12) % 12];
}

function partesMadrid(valor: Date): { dia: number; mes: number; anio: number } {
  // Intl con zona fija: el servidor puede correr en UTC (Railway/Vercel) y el día de cierre
  // de bolsa es el de Madrid, no el del reloj del proceso.
  const formateador = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const partes = formateador.formatToParts(valor);
  const obtener = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return { dia: obtener("day"), mes: obtener("month") - 1, anio: obtener("year") };
}

/**
 * Fecha en español, hora de Madrid: «1 de febrero» y solo con año si no es el actual
 * (DESIGN.md §10). `ahora` es inyectable para pruebas deterministas.
 */
export function fecha(valor: Date | string, ahora: Date = new Date()): string {
  const d = typeof valor === "string" ? new Date(valor) : valor;
  const { dia, mes, anio } = partesMadrid(d);
  const anioActual = partesMadrid(ahora).anio;
  const base = `${dia} de ${nombreMes(mes)}`;
  return anio === anioActual ? base : `${base} de ${anio}`;
}
