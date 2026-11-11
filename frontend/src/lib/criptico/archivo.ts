import type { EntradaIndice } from "./publico";
import { clavePartida } from "./partida";
import type { Idioma } from "./tipos";

export type Mes = { clave: string; entradas: EntradaIndice[] };
export type Dia = { dia: number; fecha: string };

// Meses del más reciente al más antiguo; dentro de cada mes, el número más alto primero.
export function agruparPorMes(indice: EntradaIndice[]): Mes[] {
  const porMes = new Map<string, EntradaIndice[]>();
  for (const entrada of indice) {
    const clave = entrada.fecha.slice(0, 7);
    porMes.set(clave, [...(porMes.get(clave) ?? []), entrada]);
  }
  return [...porMes.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([clave, entradas]) => ({ clave, entradas: [...entradas].sort((x, y) => y.numero - x.numero) }));
}

// Cuadrícula del mes con la semana empezando en lunes; null rellena los huecos.
export function cuadriculaDelMes(clave: string): (Dia | null)[] {
  const [anio, mes] = clave.split("-").map(Number);
  const primero = new Date(Date.UTC(anio, mes - 1, 1));
  const dias = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const celdas: (Dia | null)[] = Array<Dia | null>((primero.getUTCDay() + 6) % 7).fill(null);
  for (let dia = 1; dia <= dias; dia++) {
    celdas.push({ dia, fecha: `${clave}-${String(dia).padStart(2, "0")}` });
  }
  while (celdas.length % 7) celdas.push(null);
  return celdas;
}

// Un número busca ese número exacto; el resto busca dentro de la fecha ya formateada.
export function buscar(indice: EntradaIndice[], consulta: string, formato: (fecha: string) => string): EntradaIndice[] {
  const q = consulta.trim().toLowerCase();
  if (!q) return [];
  if (/^\d+$/.test(q)) return indice.filter(entrada => String(entrada.numero) === q);
  return indice.filter(entrada => formato(entrada.fecha).toLowerCase().includes(q));
}

// Los acertijos salen cada día, también los fines de semana: el número n cae n - actual días después del actual.
export function fechaDeNumero(fecha: string, actual: number, n: number): string {
  const dia = new Date(`${fecha.slice(0, 10)}T12:00:00Z`);
  dia.setUTCDate(dia.getUTCDate() + (n - actual));
  return dia.toISOString().slice(0, 10);
}

type Almacen = Pick<Storage, "getItem">;

function almacen(): Almacen | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

// Lo sabe este dispositivo: la partida guardada tiene resultado, no hace falta pedirlo al servidor.
export function resueltoLocal(idioma: Idioma, numero: number, storage = almacen()): boolean {
  try {
    const partida = JSON.parse(storage?.getItem(clavePartida(idioma, numero)) ?? "null") as { resultado?: string } | null;
    return partida?.resultado === "resuelto" || partida?.resultado === "solucion";
  } catch { return false; }
}

// Resuelto con ayuda: la partida terminó viendo la solución, no con la respuesta.
export function ayudaLocal(idioma: Idioma, numero: number, storage = almacen()): boolean {
  try {
    const partida = JSON.parse(storage?.getItem(clavePartida(idioma, numero)) ?? "null") as { resultado?: string } | null;
    return partida?.resultado === "solucion";
  } catch { return false; }
}
