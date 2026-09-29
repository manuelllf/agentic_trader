// Datos de EJEMPLO de la portada: tres ideas con empresas inventadas y seis meses inventados. No
// son resultados reales y la pantalla lo dice. Solo la regla de puntos coincide con la de la liga.

import type { EscudoValor } from "../_ui";

export interface Empresa { nombre: string; porque: string; peso: number }

export interface Idea {
  corto: string;
  frases: [string, string, string];
  nombre: string;
  escudo: EscudoValor;
  empresas: Empresa[];
  /** Rentabilidad de cada mes, en %, de abril a septiembre. */
  tu: number[];
  conclusion: string;
}

export const MESES = ["Abr", "May", "Jun", "Jul", "Ago", "Sep"];
/** El S&P 500 de esos mismos meses: es el mismo para las tres ideas. */
export const SP = [2.9, -3.4, 1.2, -1.8, 3.0, 0.9];

/** 3 puntos si le ganas por más de medio punto, 0 si pierdes por más, 1 si estás en medio. */
export function puntos(tu: number, sp: number): 0 | 1 | 3 {
  const d = Math.round((tu - sp) * 10) / 10;
  return d > 0.5 ? 3 : d < -0.5 ? 0 : 1;
}

export const IDEAS: Idea[] = [
  {
    corto: "Pequeñas",
    frases: ["Empresas pequeñas", "que casi no deben nada", "y crecen cada año"],
    nombre: "Brote creciente",
    escudo: { forma: "escudo", dibujo: "mitades", color1: "#0B6E68", color2: "#F2C94C", iniciales: "BC" },
    empresas: [
      { nombre: "Astilleros Norte", porque: "deuda 0,1× · margen 24 %", peso: 24 },
      { nombre: "Molino Verde", porque: "caja neta · crece 18 %", peso: 22 },
      { nombre: "Cobre Ibérico", porque: "deuda 0,2× · crece 15 %", peso: 20 },
      { nombre: "Faro Software", porque: "sin deuda · margen 31 %", peso: 18 },
      { nombre: "Nube Sur", porque: "deuda 0,1× · crece 22 %", peso: 16 },
    ],
    tu: [4.2, -5.6, 2.8, -2.9, 4.8, 1.0],
    conclusion: "Gana en los meses de subida y cae más que el mercado cuando baja.",
  },
  {
    corto: "Con dividendo",
    frases: ["Empresas grandes", "con márgenes altos", "que reparten dividendo"],
    nombre: "Pilar de margen",
    escudo: { forma: "escudo", dibujo: "mitades", color1: "#1D3A6E", color2: "#FFFFFF", iniciales: "PM" },
    empresas: [
      { nombre: "Banco Atlántico", porque: "dividendo 4,1 % · margen 32 %", peso: 24 },
      { nombre: "Eléctrica Centro", porque: "dividendo 5,0 % · deuda 0,6×", peso: 22 },
      { nombre: "Aguas del Sur", porque: "dividendo 3,6 % · margen 28 %", peso: 20 },
      { nombre: "Seguros Mar", porque: "dividendo 4,4 % · margen 26 %", peso: 18 },
      { nombre: "Cementos Duero", porque: "dividendo 3,9 % · margen 22 %", peso: 16 },
    ],
    tu: [1.4, -1.2, 0.6, -0.4, 1.9, 0.8],
    conclusion: "Aguanta cuando el mercado cae y se queda atrás cuando sube.",
  },
  {
    corto: "Con foso",
    frases: ["Empresas medianas", "con caja de sobra", "y foso ancho"],
    nombre: "Coloso de foso",
    escudo: { forma: "escudo", dibujo: "mitades", color1: "#E4572E", color2: "#1D3A6E", iniciales: "CF" },
    empresas: [
      { nombre: "Registros Unidos", porque: "margen 41 % · caja neta", peso: 24 },
      { nombre: "Datos Alfa", porque: "retención 92 % · sin deuda", peso: 22 },
      { nombre: "Pagos Beta", porque: "margen 35 % · caja neta", peso: 20 },
      { nombre: "Logística Gamma", porque: "red propia · deuda 0,2×", peso: 18 },
      { nombre: "Sensores Delta", porque: "margen 29 % · sin deuda", peso: 16 },
    ],
    tu: [3.2, -2.9, 1.9, -1.2, 3.4, 1.6],
    conclusion: "Acompaña al mercado y casi siempre se queda un poco por delante.",
  },
];

export interface FilaTabla {
  nombre: string;
  sub: string;
  escudo: EscudoValor;
  puntos: number;
  mia?: boolean;
}

const rival = (color1: string, color2: string, iniciales: string): EscudoValor =>
  ({ forma: "escudo", dibujo: "mitades", color1, color2, iniciales });

const OTROS: FilaTabla[] = [
  { nombre: "Foso ancho", sub: "@lucia", escudo: rival("#0B6E68", "#F2C94C", "FA"), puntos: 15 },
  { nombre: "Alpha", sub: "casa", puntos: 13, escudo: { forma: "circulo", dibujo: "liso", color1: "#1DE27A", color2: "#1DE27A", iniciales: "α" } },
  { nombre: "Deuda cero", sub: "@dani", escudo: rival("#3D8BD9", "#FFFFFF", "DC"), puntos: 11 },
  { nombre: "Omega", sub: "casa", puntos: 9, escudo: { forma: "circulo", dibujo: "liso", color1: "#FF6B1A", color2: "#FF6B1A", iniciales: "Ω" } },
  { nombre: "Lambda", sub: "casa", puntos: 6, escudo: { forma: "circulo", dibujo: "liso", color1: "#D8D4CB", color2: "#D8D4CB", iniciales: "λ" } },
];

export function puntosTotales(idea: Idea): number {
  return idea.tu.reduce((suma, v, i) => suma + puntos(v, SP[i]), 0);
}

/** La tabla de ejemplo con tu estrategia colocada: en un empate a puntos va detrás. */
export function tablaDe(idea: Idea): FilaTabla[] {
  const mia: FilaTabla = { nombre: "Tu estrategia", sub: "tú", escudo: idea.escudo, puntos: puntosTotales(idea), mia: true };
  return [...OTROS, mia].sort((a, b) => b.puntos - a.puntos || (a.mia ? 1 : -1));
}
