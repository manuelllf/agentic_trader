// Alma visual de la Sala Real (modo dark, paleta neutra unificada con Sala Real X y Beta —
// gris puro a propósito, sin sesgo cálido: feedback 9-sep-2026, "no me gusta esa calidez").
// Colocado junto a la página a propósito: es el lenguaje de ESTA sala, no un tema global.
import type { TradeAction } from "@/lib/types";

export const T = {
  page: "#131313",        // plano de página
  panel: "#1C1C1C",       // superficie de panel/gráfica
  panel2: "#232323",      // franja de cabecera de panel
  ring: "rgba(255,255,255,0.10)",
  grid: "#303030",        // hairline interior
  base: "#363636",        // baseline / neutro (caja)
  ink: "#EFEFED",         // tinta clara, nunca blanco puro
  ink2: "#A3A3A0",
  muted: "#6E6E6B",
  good: "#6BBE8A",        // P&L positivo (reservado), verde salvia -- no un verde semáforo
  bad: "#E0776C",         // P&L negativo / venta / crítico, coral cálido
  warn: "#fab219",        // órdenes trabajando / simulación
  buy: "#4FA39D",         // compra + acento único de marca, unificado con Sala Real X
};

/* Serie categórica (orden fijo, validado): posiciones 1..5. El verde queda RESERVADO al P&L. */
export const SERIES = ["#4FA39D", "#199e70", "#c98500", "#9085e9", "#d55181"];

// Tipografía propia de la sala (IBM Plex vía next/font en layout.tsx, variables CSS): Sans
// para texto, Mono para cifras/tickers -- una terminal de datos alinea sus números, no los
// deja en la tipografía de sistema. Mismo patrón que Sala Real X (ver momentum/tokens.ts).
export const MONO = "font-[family-name:var(--font-real-mono)]";
export const SANS = "var(--font-real-sans), ui-sans-serif, system-ui, sans-serif";
export const NUMS = `${MONO} tabular-nums`;

// `<input type="number">` trae spinner nativo (blanco, fuera de tema) en Chrome/Safari — mismo
// problema que ya se documentó y resolvió a mano en ScanConfigModal (`.cfg-num`), aquí como
// clases Tailwind reutilizables para no repetir el `<style jsx global>` en cada sitio nuevo.
export const NUM_INPUT =
  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none " +
  "[&::-webkit-inner-spin-button]:appearance-none";

export const isBuy = (a: TradeAction) => a === "comprar" || a === "ampliar";
