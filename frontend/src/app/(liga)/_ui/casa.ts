/** Alpha/Omega/Lambda: esmeralda, cobre y grafito, con el glifo en tinta clara. */
export const CASA = {
  alpha: { color: "#0F6B57", tinta: "#E6F4EE", glifo: "α", nombre: "Alpha" },
  omega: { color: "#B5602A", tinta: "#FFF0E2", glifo: "Ω", nombre: "Omega" },
  lambda: { color: "#4A5360", tinta: "#EDF0F3", glifo: "λ", nombre: "Lambda" },
} as const;

export type ClaveCasa = keyof typeof CASA;
