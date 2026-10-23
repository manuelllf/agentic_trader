import { normalizar, validarLetra } from "./letras";
import type { Acertijo, Ayuda, Detalle, Idioma } from "./tipos";

export type Partida = {
  letras: string[];
  ayudas: Ayuda[];
  resultado: "jugando" | "resuelto" | "solucion";
  detalle: Detalle | null;
  registrado: boolean;
};
type Almacen = Pick<Storage, "getItem" | "setItem">;
const tipos: Ayuda[] = ["def", "ind", "mat", "letra"];
export const clavePartida = (idioma: Idioma, numero: number) => `criptico:v1:${idioma}:${numero}`;
export const nuevaPartida = (longitud: number): Partida => ({
  letras: Array(longitud).fill(""), ayudas: [], resultado: "jugando", detalle: null, registrado: false,
});

function almacen(): Almacen | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function esDetalle(valor: unknown): valor is Detalle {
  if (!valor || typeof valor !== "object") return false;
  const d = valor as Detalle;
  return [d.respuesta, d.palabra, d.resolucion, d.concepto, d.ejemplo].every(x => typeof x === "string")
    && (d.regla_catalogo === null || typeof d.regla_catalogo === "string");
}

export function cargarPartida(a: Pick<Acertijo, "idioma" | "numero" | "longitud">, storage = almacen()): Partida {
  try {
    const p = JSON.parse(storage?.getItem(clavePartida(a.idioma, a.numero)) ?? "null") as Partida | null;
    if (!p || !Array.isArray(p.letras) || p.letras.length !== a.longitud
      || !p.letras.every(l => typeof l === "string" && (l === "" || validarLetra(l, a.idioma)))
      || !Array.isArray(p.ayudas) || !p.ayudas.every(x => tipos.includes(x))
      || new Set(p.ayudas).size !== p.ayudas.length || typeof p.registrado !== "boolean"
      || !["jugando", "resuelto", "solucion"].includes(p.resultado)
      || (p.resultado !== "jugando" && !esDetalle(p.detalle))
      || (p.ayudas.includes("letra") && !p.letras[0])) return nuevaPartida(a.longitud);
    return { ...p, letras: p.letras.map(normalizar) };
  } catch { return nuevaPartida(a.longitud); }
}

export function guardarPartida(a: Pick<Acertijo, "idioma" | "numero">, p: Partida, storage = almacen()): void {
  try { storage?.setItem(clavePartida(a.idioma, a.numero), JSON.stringify(p)); } catch { /* El juego funciona también sin almacenamiento. */ }
}

export function bienvenidaVista(storage = almacen()): boolean {
  try { return storage?.getItem("criptico:bienvenida") === "1"; } catch { return false; }
}

export function guardarBienvenida(storage = almacen()): void {
  try { storage?.setItem("criptico:bienvenida", "1"); } catch { /* No impide cerrar la bienvenida. */ }
}

export function escribir(p: Partida, indice: number, letra: string, idioma: Idioma): Partida {
  if (p.resultado !== "jugando" || !validarLetra(letra, idioma) || indice < 0 || indice >= p.letras.length
    || (indice === 0 && p.ayudas.includes("letra"))) return p;
  return { ...p, letras: p.letras.map((l, i) => i === indice ? normalizar(letra) : l) };
}

export function borrar(p: Partida, indice: number): { partida: Partida; indice: number } {
  if (p.resultado !== "jugando") return { partida: p, indice };
  let i = p.letras[indice] ? indice : indice - 1;
  while (i >= 0 && (!p.letras[i] || (i === 0 && p.ayudas.includes("letra")))) i--;
  if (i < 0) return { partida: p, indice };
  return { partida: { ...p, letras: p.letras.map((l, n) => n === i ? "" : l) }, indice: i };
}
