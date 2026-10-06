// Curvas del EJEMPLO: seis jornadas inventadas de tu estrategia, del S&P 500 y del resto de la liga.
// No es un backtest: la forma depende solo de qué cinco empresas forman la cartera.

import { clamp, gaussiana, hashTexto, mulberry32, type Empresa } from "./universo";

export const DIAS = 126; // seis jornadas de 21 sesiones
export const SESIONES_JORNADA = 21;
export const SP_FINAL = 9.8;
/** Otras estrategias del ejemplo: el índice de su nombre en `landing_liga_nombres` y si es de la casa. */
export const OTRAS = [
  { alias: "@lucia" }, { alias: "@marta" }, { casa: true }, { alias: "@pablo_r" }, { alias: "@ines" }, { casa: true },
  { alias: "@dani" }, { alias: "@jorge" }, { alias: "@carmen" }, { casa: true }, { alias: "@sergio" }, { alias: "@ana_v" },
  { alias: "@raul" }, { alias: "@elena" }, { alias: "@tomas" }, { alias: "@nuria" }, { alias: "@leo" }, { alias: "@irene" },
  { alias: "@mario" }, { alias: "@paula" }, { alias: "@hugo" }, { alias: "@sofia" }, { alias: "@alba" },
] as const;

/**
 * Camino diario que sale de 0 y llega exactamente al objetivo: deriva recta, un puente browniano
 * propio que se apaga al final y el vaivén del mercado (sin su deriva) multiplicado por la beta.
 */
export function caminar(semilla: number, objetivo: number, beta: number, ruido: number, bache: boolean,
  mercado: number[] | null): number[] {
  const g = gaussiana(mulberry32(semilla));
  const w = [0];
  for (let d = 1; d <= DIAS; d++) w.push(w[d - 1] + ruido * g());
  const fin = Math.log(1 + objetivo / 100);
  return w.map((v, d) => {
    const propio = (v - (w[DIAS] * d) / DIAS) * Math.min(1, (DIAS - d) / 14 + 0.25);
    const vaiven = mercado ? beta * (mercado[d] - (mercado[DIAS] * d) / DIAS) : 0;
    const caida = bache ? -0.06 * Math.sin(Math.PI * clamp((d - 42) / 44, 0, 1)) : 0;
    return (Math.exp((fin * d) / DIAS + propio + vaiven + caida) - 1) * 100;
  });
}

export interface Estrategia {
  /** -1 para la tuya; si no, el índice en `OTRAS`. */
  indice: number;
  casa: boolean;
  alias: string | null;
  serie: number[];
  puesto: number;
  puestoAntes: number;
}

export interface Series {
  sp: number[];
  tu: number[];
  todas: Estrategia[];
  ranking: Estrategia[];
  yo: Estrategia;
}

export function crearSeries(cartera: Empresa[]): Series {
  const sp = caminar(7, SP_FINAL, 0, 0.0068, false, null);
  const spLog = sp.map((v) => Math.log(1 + v / 100));
  const h = hashTexto(cartera.map((e) => e.ticker ?? "").join(""));
  const tuFinal = Math.round((SP_FINAL + ((h % 1000) / 1000) * 11 - 3.2) * 10) / 10;
  const tu = caminar(h, tuFinal, 1.04, 0.0048, true, spLog);
  const rnd = mulberry32(99);
  const otras: Estrategia[] = OTRAS.map((o, i) => {
    const fin = Math.round((SP_FINAL - 14 + rnd() * 24) * 10) / 10;
    const serie = caminar(1000 + i * 17, fin, 0.75 + rnd() * 0.5, 0.003 + rnd() * 0.005, false, spLog);
    return { indice: i, casa: "casa" in o, alias: "alias" in o ? o.alias : null, serie, puesto: 0, puestoAntes: 0 };
  });
  const yo: Estrategia = { indice: -1, casa: false, alias: null, serie: tu, puesto: 0, puestoAntes: 0 };
  const todas = [yo, ...otras];
  const orden = (dia: number) => todas.slice().sort((a, b) => b.serie[dia] - a.serie[dia]);
  const ahora = orden(DIAS), antes = orden(DIAS - SESIONES_JORNADA);
  todas.forEach((s) => { s.puesto = ahora.indexOf(s) + 1; s.puestoAntes = antes.indexOf(s) + 1; });
  return { sp, tu, todas, ranking: ahora, yo };
}

/** Valor de una serie en un día fraccionario, para que el trazo avance sin saltos. */
export function valorEn(serie: number[], d: number): number {
  const n = Math.floor(d);
  return n >= DIAS ? serie[DIAS] : serie[n] + (serie[n + 1] - serie[n]) * (d - n);
}
