// El catálogo de herramientas del agente (backend/app/agente/herramientas.py, CATALOGO), siempre con su
// nombre real, agrupado por lo que toca cada una. Si cambia el catálogo, cambia aquí.
export const FAMILIAS = [
  { clave: "mercado", color: "#6FB5D9", herramientas: ["screen", "search_universe", "price", "history", "fundamentals", "valuation", "news"] },
  { clave: "cartera", color: "#E2B254", herramientas: ["portfolio", "watchlist", "watch", "unwatch", "card_read", "card_write", "journal"] },
  { clave: "memoria", color: "#B79CE8", herramientas: ["propose_lesson", "retire_lesson", "propose_philosophy_change", "schedule_wakeup", "cancel_wakeup"] },
] as const;

export type Familia = (typeof FAMILIAS)[number];
export const HERRAMIENTAS: readonly string[] = FAMILIAS.flatMap(f => f.herramientas);
export const familiaDe = (nombre: string): Familia => FAMILIAS.find(f => (f.herramientas as readonly string[]).includes(nombre)) ?? FAMILIAS[0];

/** Vueltas que el código permite al agente (config.max_pasos). */
export const MAX_VUELTAS = 8;

/** Límites del código (limites.Limites). */
export const LIMITES = {
  posiciones: 5, pesoCompra: 30, pesoDefensivo: 15, pesoRevision: 45, caidaPosicion: -30,
  caidaDefensiva: -30, caidaPausa: -50, presupuestoMes: 10, aperturaSobreCierre: 3, diasAntesDeEvento: 7,
} as const;
