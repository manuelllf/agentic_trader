// Cifras de la portada en la forma de cada idioma: 5.723 y 82,7 % en español; 5,723 and 82.7% en inglés.
export type Idioma = "es" | "en";

const MENOS = "−";

export const miles = (n: number, idioma: Idioma) => new Intl.NumberFormat(idioma === "es" ? "es-ES" : "en-US", { useGrouping: true }).format(n)
  // es-ES no agrupa los números de cuatro cifras; la maqueta sí (5.723).
  .replace(/^(\d)(\d{3})$/, idioma === "es" ? "$1.$2" : "$1,$2");

export const decimal = (n: number, idioma: Idioma, digitos = 1) => {
  const texto = Math.abs(n).toFixed(digitos);
  return `${n < 0 ? MENOS : ""}${idioma === "es" ? texto.replace(".", ",") : texto}`;
};

/** Con signo siempre: −1,6 o +0,4. */
export const conSigno = (n: number, idioma: Idioma) => `${n >= 0 ? "+" : ""}${decimal(n, idioma)}`;

export const porcentaje = (n: number, idioma: Idioma) => `${conSigno(n, idioma)}${idioma === "es" ? " %" : "%"}`;

/** El S&P cayó «un 8,6 %»: sin signo, porque el verbo ya dice si sube o baja. */
export const porcentajeSinSigno = (n: number, idioma: Idioma) => `${decimal(Math.abs(n), idioma)}${idioma === "es" ? " %" : "%"}`;

const fecha = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);

/** «30 de octubre» / «October 30». */
export const diaMes = (iso: string, idioma: Idioma) =>
  new Intl.DateTimeFormat(idioma === "es" ? "es-ES" : "en-US", { day: "numeric", month: "long", timeZone: "UTC" }).format(fecha(iso));

/** «del 16 al 20 de noviembre» / «from November 16 to 20»: el mes solo una vez si es el mismo. */
export function tramo(desde: string, hasta: string, idioma: Idioma): { desde: string; hasta: string } {
  const mismoMes = desde.slice(0, 7) === hasta.slice(0, 7);
  if (!mismoMes) return { desde: diaMes(desde, idioma), hasta: diaMes(hasta, idioma) };
  const d1 = String(fecha(desde).getUTCDate()), d2 = String(fecha(hasta).getUTCDate());
  return idioma === "es" ? { desde: d1, hasta: diaMes(hasta, idioma) } : { desde: diaMes(desde, idioma), hasta: d2 };
}
