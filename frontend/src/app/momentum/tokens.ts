// Alma visual de Sala Real X: paleta propia, refinada 8-sep-2026 tras feedback ("bordecitos de
// color en las cards" = ai slop) -- el acento morado ya NO decora cards sueltas, solo aparece
// donde significa algo real (marca de la sala, punto activo del carrusel). Referencia real:
// terminales de trading (Bloomberg, fintech dark-first), no un dashboard SaaS genérico.
export const T = {
  page: "#0b0b0a",
  panel: "#171715",
  panel2: "#1e1e1b",
  ring: "rgba(255,255,255,0.09)",
  grid: "#2c2c28",
  base: "#38382f",
  ink: "#f4f3ee",
  ink2: "#c2c0b6",
  muted: "#87857c",
  good: "#33c15a",
  bad: "#f0524a",
  warn: "#f5b022",
  buy: "#3987e5",
  // Acento propio de Sala Real X, usado con cuentagotas: identidad de marca (punto junto al
  // nombre) y punto activo del carrusel -- nunca como borde decorativo de una card.
  entry: "#7c6bf6",
};

// Tipografía propia de la sala (IBM Plex vía next/font en layout.tsx, variables CSS): Sans
// para texto, Mono para tickers/precios/porcentajes -- una terminal de datos alinea sus
// números, no los deja en la tipografía de sistema.
export const MONO = "font-[family-name:var(--font-momentum-mono)]";
export const SANS = "var(--font-momentum-sans), ui-sans-serif, system-ui, sans-serif";
export const NUMS = `${MONO} tabular-nums`;
