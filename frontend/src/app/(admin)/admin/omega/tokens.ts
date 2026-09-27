// Alma visual de Omega: paleta propia, refinada 8-sep-2026 tras feedback ("bordecitos de
// color en las cards" = ai slop) -- el acento morado ya NO decora cards sueltas, solo aparece
// donde significa algo real (marca de la sala, punto activo del carrusel). Referencia real:
// terminales de trading (Bloomberg, fintech dark-first), no un dashboard SaaS genérico.
export const T = {
  // Casi negro, no #131313 (feedback 12-sep-2026: "más solidez, más contraste con el panel") --
  // no #000 puro, que en OLED se ve duro. Gris puro, sin sesgo cálido (feedback 9-sep-2026: "no
  // me gusta esa calidez").
  page: "#0A0A0A",
  panel: "#1C1C1C",
  panel2: "#232323",
  ring: "rgba(255,255,255,0.10)",
  grid: "#303030",
  base: "#363636",
  ink: "#EFEFED",
  ink2: "#A3A3A0",
  muted: "#6E6E6B",
  good: "#6BBE8A",
  bad: "#E0776C",
  warn: "#f5b022",
  buy: "#4FA39D",
  // Acento único de las 3 salas (antes morado, unificado 9-sep): identidad de marca y punto
  // activo del carrusel -- nunca como borde decorativo de una card.
  entry: "#4FA39D",
};

// Tipografía propia de la sala (Geist vía next/font en layout.tsx, variables CSS): Sans
// para texto, Mono para tickers/precios/porcentajes -- una terminal de datos alinea sus
// números, no los deja en la tipografía de sistema.
export const MONO = "font-[family-name:var(--font-momentum-mono)]";
export const SANS = "var(--font-momentum-sans), ui-sans-serif, system-ui, sans-serif";
export const NUMS = `${MONO} tabular-nums`;
