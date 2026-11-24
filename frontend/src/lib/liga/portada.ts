// La página la lee en el servidor: sin `@/lib/api`, que arrastra el cliente de Supabase del navegador.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Datos de la demo de la portada (GET /liga/aprender/portada): la foto activa con los 7 estilos fijos.
export type CincoDemo = { ticker: string; nombre: string; rango: number; nota: number };
export type ReglaDemo = { clave: string; params: Record<string, unknown>; detalle: string };
export type EstiloDemo = { pasan: number; mapa: string; cinco: CincoDemo[]; reglas: ReglaDemo[] };
export type CasaSemana = { casa: "alpha" | "lambda" | "omega"; rentabilidad: number | null; dif_sp: number | null; puntos: number | null };
export type SemanaDemo = { dia_inicio: string; dia_fin: string; sp: number | null; casa: CasaSemana[] };
export type PortadaDemo = {
  foto_id: number;
  notas_del: string | null;
  total: number;
  anillos: { rango: number; musd: number }[];
  estilos: Record<string, EstiloDemo>;
  semana: SemanaDemo | null;
};
export type EmpresaRango = { rango: number; ticker: string; nombre: string | null; musd: number | null; sector: string | null };

/** Orden de las ideas en la portada (maqueta v15). */
export const ORDEN_ESTILOS = ["calidad", "dividendo", "crecimiento", "maduros", "balance", "castigadas", "pequenas"] as const;

// Las cifras de la liga llegan como Decimal serializado ("-10.2000").
const cifra = (v: unknown): number | null => v === null || v === undefined || v === "" ? null : Number(v);

export function normalizarPortada(crudo: PortadaDemo): PortadaDemo {
  const semana = crudo.semana && {
    ...crudo.semana,
    sp: cifra(crudo.semana.sp),
    casa: crudo.semana.casa.map((c) => ({ ...c, rentabilidad: cifra(c.rentabilidad), dif_sp: cifra(c.dif_sp) })),
  };
  return { ...crudo, semana };
}

/** En el servidor: si la API falla, la portada sale sin demo en vez de romperse. */
export async function leerPortadaDemo(idioma: "es" | "en"): Promise<PortadaDemo | null> {
  try {
    const r = await fetch(`${API_URL}/liga/aprender/portada?idioma=${idioma}`, { next: { revalidate: 600 } });
    if (!r.ok) return null;
    const datos = normalizarPortada(await r.json());
    return ORDEN_ESTILOS.every((k) => datos.estilos[k]) ? datos : null;
  } catch {
    return null;
  }
}

/** En el navegador, al tocar una empresa del globo. */
export async function empresaPorRango(rango: number): Promise<EmpresaRango | null> {
  try {
    const r = await fetch(`${API_URL}/liga/aprender/portada/empresa/${rango}`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** La regla de un estilo, con el texto llano de la portada si lo hay. */
export function idRegla({ clave, params: p }: ReglaDemo): string | null {
  switch (clave) {
    case "rentables": return `roe${p.roe_pct}`;
    case "margen": return `margen${p.margen_pct}`;
    case "barata": return `per${p.per}`;
    case "tamano": return Number(p.desde) === 10000 ? "grande" : Number(p.desde) === 300 && Number(p.hasta) === 2000 ? "pequena" : null;
    case "fcf": return `fcf${p.p}`;
    case "payout": return `payout${p.p}`;
    case "beta": return `beta${p.p}`;
    case "dividendo": return `div${p.dividendo_pct}`;
    case "deuda": return `deuda${p.anios}`;
    case "crecen": return `crece${p.crecimiento_pct}`;
    case "caja_neta": return "caja";
    case "castigadas_pct": return `caida${p.p}`;
    default: return null;
  }
}
