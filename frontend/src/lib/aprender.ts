import type { Locale } from "@/i18n/locale";
import { miles } from "@/lib/liga/format";

// Datos públicos de /aprender y de Cómo funciona: los pide el servidor y se cachean unos minutos.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type PremioPublico = {
  visible: boolean;
  temporada?: { id: number; nombre: string; n_jornadas: number; clave: string | null } | null;
  calculado?: boolean;
  cuentas?: number;
  escalon?: number;
  umbral_basico?: number | null;
  umbral_completo?: number | null;
  importes?: Record<string, number[]>;
};

export type CicloAprender = {
  jornada: { numero: number | null; dia_base: string; dia_inicio: string; dia_fin: string };
  escaneo: string | null;
  cierre_jornada: string;
  corte: string;
  cierre_cambios: string;
  apertura: string;
  puntos: { banda: string; gana: number; empata: number; pierde: number };
  premio: PremioPublico;
};

export type MercadoAprender = {
  foto_id: number;
  total: number;
  roe: { minimo: number; maximo: number; paso: number; defecto: number; pasan: number[] };
};

async function leer<T>(ruta: string, segundos: number): Promise<T | null> {
  try {
    const respuesta = await fetch(`${API_URL}${ruta}`, { next: { revalidate: segundos } });
    return respuesta.ok ? ((await respuesta.json()) as T) : null;
  } catch {
    return null;
  }
}

export const leerCiclo = () => leer<CicloAprender>("/liga/aprender/ciclo", 300);
export const leerMercado = () => leer<MercadoAprender>("/liga/aprender/mercado", 600);

/** Cuántas empresas pasan la regla del ROE con ese umbral; null si el umbral no está en la tabla. */
export function pasanConRoe(m: MercadoAprender, umbral: number): number | null {
  const i = (umbral - m.roe.minimo) / m.roe.paso;
  return Number.isInteger(i) && i >= 0 && i < m.roe.pasan.length ? m.roe.pasan[i] : null;
}

/** Las cifras de Cómo funciona ya formateadas; sin datos, null (la página no inventa ninguna). */
export function cifrasDelMetodo(m: MercadoAprender | null, locale: Locale) {
  if (!m) return null;
  const pasan = pasanConRoe(m, m.roe.defecto);
  return {
    total: miles(m.total, locale),
    umbral: m.roe.defecto,
    pasan: pasan === null ? null : miles(pasan, locale),
  };
}
