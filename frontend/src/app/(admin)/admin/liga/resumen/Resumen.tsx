import type { Pendiente } from "./logica";

// Respuesta de /liga/admin/panel/resumen. La pantalla vive en la portada de /admin (_panel/PortadaVennett.tsx).
export type ResumenAdminOut = {
  pendientes: Pendiente[];
  proximo: { paso: "foto" | "formar" | "cerrar"; jornada: number; cuando: string; automatico: boolean } | null;
  vistazo: { cuentas: number; activas_7d: number; en_juego: number; tope_ia_pct: number | string | null };
};
