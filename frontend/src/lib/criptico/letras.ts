import type { Idioma } from "./tipos";

export function normalizar(texto: string): string {
  // La eñe es una letra propia, también al descomponer Unicode.
  return texto.normalize("NFC").toUpperCase().split("Ñ")
    .map(parte => parte.normalize("NFD").replace(/[\u0300-\u036f]/g, "")).join("Ñ");
}

export function validarLetra(texto: string, idioma: Idioma = "es"): boolean {
  return (idioma === "es" ? /^[A-ZÑ]$/ : /^[A-Z]$/).test(normalizar(texto));
}

export function comparar(a: string, b: string): boolean {
  return normalizar(a) === normalizar(b);
}
