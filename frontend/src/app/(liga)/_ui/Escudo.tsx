import { useId } from "react";

// Puerto de crestSVG/lum/SHAPES/PALETTE de la maqueta (DESIGN.md §6 y §14).

export type FormaEscudo = "circulo" | "escudo" | "hexagono";
export type DibujoEscudo = "liso" | "mitades" | "diagonal" | "franja";

/** Coincide 1:1 con las columnas forma/dibujo/color1/color2/iniciales de liga.estrategias. */
export interface EscudoValor {
  forma: FormaEscudo;
  dibujo: DibujoEscudo;
  color1: string;
  color2?: string | null;
  iniciales?: string | null;
}

export const FORMAS: Record<FormaEscudo, string> = {
  circulo: "M20 1.5a18.5 18.5 0 1 1 0 37a18.5 18.5 0 1 1 0-37Z",
  escudo: "M20 1.5 37 7v12c0 10-7.5 16.5-17 19.5C10.5 35.5 3 29 3 19V7Z",
  hexagono: "M20 1.5 36.5 11v18L20 38.5 3.5 29V11Z",
};

/** 13 colores de la paleta libre del editor de escudo (DESIGN.md §2), además de los de casa. */
export const PALETA = [
  "#0B6E68", "#1D3A6E", "#3D8BD9", "#2F7D57", "#8FBF3F", "#F2C94C", "#E4572E",
  "#C0392B", "#8B1E3F", "#7A5C3E", "#5B6470", "#141414", "#FFFFFF",
] as const;

/** Luminancia relativa (WCAG) para decidir si las iniciales van en tinta clara u oscura. */
export function luminancia(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const canal = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canal[0] + 0.7152 * canal[1] + 0.0722 * canal[2];
}

const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];

/** Escudo al azar para una estrategia nueva (DESIGN.md §6: nunca dos iguales por defecto). */
export function escudoAleatorio(): EscudoValor {
  const formas: FormaEscudo[] = ["circulo", "escudo", "hexagono"];
  const dibujos: DibujoEscudo[] = ["liso", "mitades", "diagonal", "franja"];
  const color1 = pick(PALETA);
  let color2 = pick(PALETA);
  while (color2 === color1) color2 = pick(PALETA);
  return { forma: pick(formas), dibujo: pick(dibujos), color1, color2, iniciales: "" };
}

/** Alpha/Omega/Lambda: color y glifo de casa (DESIGN.md §2, tabla «Colores de la casa»). */
export const CASA = {
  alpha: { color: "#1DE27A", glifo: "α", nombre: "Alpha" },
  omega: { color: "#FF6B1A", glifo: "Ω", nombre: "Omega" },
  lambda: { color: "#D8D4CB", glifo: "λ", nombre: "Lambda" },
} as const;

export type ClaveCasa = keyof typeof CASA;

/** Escudo de la casa: círculo liso del color de la casa con su glifo (DESIGN.md §6). */
export function escudoCasa(clave: ClaveCasa): EscudoValor {
  const { color, glifo } = CASA[clave];
  return { forma: "circulo", dibujo: "liso", color1: color, color2: color, iniciales: glifo };
}

export interface EscudoProps {
  valor: EscudoValor;
  /** Las salas tienen una identidad fija, independiente del escudo guardado en la API. */
  casa?: ClaveCasa | null;
  /** Nombre accesible completo, p. ej. «Escudo de Foso ancho» o «Escudo de la casa: Alpha». */
  etiqueta: string;
  /** Lado en px (DESIGN.md §6: 24 tabla, 34 filas, 52 ficha, 72 Crear...). */
  tamano?: number;
}

/** El glifo de casa alpha («α») es una minúscula sin astil: a igual fontSize se ve más pequeño
 *  que Ω (mayúscula, altura de caja completa) y λ (con astil ascendente). Se compensa solo aquí,
 *  por glifo, sin tocar los otros dos ni pasar a mayúscula «Α» (DESIGN.md, feedback de Manuel). */
const AJUSTE_GLIFO: Record<string, { escala: number; dy: number }> = {
  α: { escala: 1.22, dy: 0.6 },
};

export function Escudo({ valor: valorGuardado, casa, etiqueta, tamano = 34 }: EscudoProps) {
  const id = useId();
  const valor = casa ? escudoCasa(casa) : valorGuardado;
  const d = FORMAS[valor.forma] ?? FORMAS.circulo;
  const c1 = valor.color1;
  const c2 = valor.color2 || valor.color1;
  const claro = luminancia(c1) > 0.4;
  const tintaIniciales = casa || claro ? "#111315" : "#FFFFFF";
  const haloIniciales = claro ? "rgba(255,255,255,.6)" : "rgba(0,0,0,.4)";
  const ini = (valor.iniciales || "").slice(0, 2);
  const ajuste = AJUSTE_GLIFO[ini];

  return (
    <svg
      className={`crest${casa ? " crest-casa" : ""}`}
      data-casa={casa || undefined}
      width={tamano}
      height={tamano}
      viewBox="0 0 40 40"
      role="img"
      aria-label={etiqueta}
    >
      <defs>
        <clipPath id={id}>
          <path d={d} />
        </clipPath>
      </defs>
      {casa ? (
        <>
          <rect x={1.5} y={1.5} width={37} height={37} rx={9} fill={c1} />
          <rect x={4} y={4} width={32} height={32} rx={6.5}
            fill="none" stroke="#111315" strokeOpacity={0.18} strokeWidth={0.8} />
        </>
      ) : <g clipPath={`url(#${id})`}>
        {valor.dibujo === "mitades" && (
          <>
            <rect width={40} height={40} fill={c1} />
            <rect x={20} width={20} height={40} fill={c2} />
          </>
        )}
        {valor.dibujo === "diagonal" && (
          <>
            <rect width={40} height={40} fill={c1} />
            <path d="M40 0V40H0Z" fill={c2} />
          </>
        )}
        {valor.dibujo === "franja" && (
          <>
            <rect width={40} height={40} fill={c1} />
            <rect x={14} width={12} height={40} fill={c2} />
          </>
        )}
        {valor.dibujo === "liso" && <rect width={40} height={40} fill={c1} />}
      </g>}
      {!casa && <path d={d} fill="none" stroke="var(--crest-ring)" strokeWidth={1.5} />}
      {ini && (
        <text
          x={20}
          y={21.5 + (ajuste?.dy ?? 0)}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="var(--font-lg)"
          fontWeight={800}
          fontSize={(ini.length > 1 ? 14 : casa ? 21 : 19) * (ajuste?.escala ?? 1)}
          fill={tintaIniciales}
          stroke={valor.dibujo === "liso" ? "none" : haloIniciales}
          strokeWidth={valor.dibujo === "liso" ? 0 : 3}
          paintOrder="stroke"
        >
          {ini}
        </text>
      )}
    </svg>
  );
}
