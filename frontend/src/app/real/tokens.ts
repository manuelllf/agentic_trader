// Alma visual de la Sala Real (modo dark; paleta validada CVD + contraste sobre #0d0d0d).
// Colocado junto a la página a propósito: es el lenguaje de ESTA sala, no un tema global.
import type { TradeAction } from "@/lib/types";

export const T = {
  page: "#0d0d0d",        // plano de página
  panel: "#1a1a19",       // superficie de panel/gráfica
  panel2: "#202020",      // franja de cabecera de panel
  ring: "rgba(255,255,255,0.10)",
  grid: "#2c2c2a",        // hairline interior
  base: "#383835",        // baseline / neutro (caja)
  ink: "#ffffff",
  ink2: "#c3c2b7",
  muted: "#898781",
  good: "#0ca30c",        // P&L positivo (reservado)
  bad: "#d03b3b",         // P&L negativo / venta / crítico
  warn: "#fab219",        // órdenes trabajando / simulación
  buy: "#3987e5",         // compra (slot azul)
};

/* Serie categórica (orden fijo): posiciones 1..7 (embudo 5→7, ver settings.max_positions). Las
   5 primeras son las validadas CVD originales; cian y pizarra se añadieron detrás, separadas de
   azul/verde por tono para no confundirse en daltonismo. El verde queda RESERVADO al P&L. */
export const SERIES = [
  "#3987e5", "#199e70", "#c98500", "#9085e9", "#d55181", "#2bb3c0", "#6b7a8f",
];

export const NUMS = "tabular-nums";

// `<input type="number">` trae spinner nativo (blanco, fuera de tema) en Chrome/Safari — mismo
// problema que ya se documentó y resolvió a mano en ScanConfigModal (`.cfg-num`), aquí como
// clases Tailwind reutilizables para no repetir el `<style jsx global>` en cada sitio nuevo.
export const NUM_INPUT =
  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none " +
  "[&::-webkit-inner-spin-button]:appearance-none";

export const isBuy = (a: TradeAction) => a === "comprar" || a === "ampliar";
