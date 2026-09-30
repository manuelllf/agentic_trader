// Datos de EJEMPLO de la portada: empresas conocidas solo como ilustración y seis meses inventados,
// sin cifras inventadas por empresa. La pantalla lo dice; solo la regla de puntos es la real.

import type { EscudoValor } from "../_ui";

export interface Empresa { nombre: string; porque: string; peso: number }

export interface Idea {
  frases: [string, string, string];
  nombre: string;
  escudo: EscudoValor;
  empresas: Empresa[];
  /** Rentabilidad de cada mes, en %, de abril a septiembre. */
  tu: number[];
  conclusion: string;
}

export const MESES = ["Abr", "May", "Jun", "Jul", "Ago", "Sep"];
/** El S&P 500 de esos mismos meses. */
export const SP = [2.9, -3.4, 1.2, -1.8, 3.0, 0.9];

/** 3 puntos si le ganas por más de 0,2 puntos, 0 si pierdes por más, 1 si estás en medio. */
export function puntos(tu: number, sp: number): 0 | 1 | 3 {
  const d = Math.round((tu - sp) * 10) / 10;
  return d > 0.2 ? 3 : d < -0.2 ? 0 : 1;
}

export const EJEMPLO: Idea = {
  frases: ["Empresas grandes", "con caja de sobra", "y márgenes altos"],
  nombre: "Pilar de caja",
  escudo: { forma: "escudo", dibujo: "mitades", color1: "#0B6E68", color2: "#F2C94C", iniciales: "PC" },
  empresas: [
    { nombre: "Microsoft", porque: "MSFT · margen alto · caja neta", peso: 24 },
    { nombre: "Apple", porque: "AAPL · margen alto · mucha caja", peso: 22 },
    { nombre: "NVIDIA", porque: "NVDA · crece · margen alto", peso: 20 },
    { nombre: "Alphabet", porque: "GOOGL · caja neta · margen alto", peso: 18 },
    { nombre: "iShares MSCI World", porque: "IWDA · ETF · cientos de empresas", peso: 16 },
  ],
  tu: [4.2, -5.6, 2.8, -2.9, 4.8, 1.0],
  conclusion: "Gana en los meses de subida y cae más que el mercado cuando baja.",
};

export interface FilaTabla {
  nombre: string;
  sub: string;
  escudo: EscudoValor;
  puntos: number;
  mia?: boolean;
}

const rival = (color1: string, color2: string, iniciales: string): EscudoValor =>
  ({ forma: "escudo", dibujo: "mitades", color1, color2, iniciales });
const casa = (color: string, iniciales: string): EscudoValor =>
  ({ forma: "circulo", dibujo: "liso", color1: color, color2: color, iniciales });

const OTROS: FilaTabla[] = [
  { nombre: "Foso ancho", sub: "@lucia", escudo: rival("#0B6E68", "#F2C94C", "FA"), puntos: 15 },
  { nombre: "Alpha", sub: "casa", escudo: casa("#1DE27A", "α"), puntos: 13 },
  { nombre: "Deuda cero", sub: "@dani", escudo: rival("#3D8BD9", "#FFFFFF", "DC"), puntos: 11 },
  { nombre: "Omega", sub: "casa", escudo: casa("#FF6B1A", "Ω"), puntos: 9 },
  { nombre: "Lambda", sub: "casa", escudo: casa("#D8D4CB", "λ"), puntos: 6 },
];

export function puntosTotales(idea: Idea): number {
  return idea.tu.reduce((suma, v, i) => suma + puntos(v, SP[i]), 0);
}

/** La tabla de ejemplo con tu estrategia colocada: en un empate a puntos va detrás. */
export function tablaDe(idea: Idea): FilaTabla[] {
  const mia: FilaTabla = { nombre: "Tu estrategia", sub: "tú", escudo: idea.escudo, puntos: puntosTotales(idea), mia: true };
  return [...OTROS, mia].sort((a, b) => b.puntos - a.puntos || (a.mia ? 1 : -1));
}
