// Fuera del componente de cliente: la página del servidor también la usa para leer `?v=`.
export const VISTAS = ["hoy", "informes", "agente", "control"] as const;
export type Vista = (typeof VISTAS)[number];

export const vistaDe = (v: string | undefined): Vista => (VISTAS as readonly string[]).includes(v ?? "") ? (v as Vista) : "hoy";
