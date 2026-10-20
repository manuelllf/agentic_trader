export function titular(n: number) {
  return ["admin_resumen_titular", { count: n }] as const;
}

export function destinoDe(seccion: string): string {
  const destinos: Record<string, string> = {
    jornadas: "/admin/liga/jornadas", revisar: "/admin/liga/revisar",
    premio: "/admin/liga/premio", coste: "/admin/liga/coste-ia", consultas: "/admin/liga/consultas",
  };
  return destinos[seccion] ?? "/admin/liga";
}

export function nombreProceso(id: string): string {
  const claves: Record<string, string> = {
    temporadas: "admin_liga_process_seasons", foto: "admin_liga_process_photo",
    formar: "admin_liga_process_form", diario: "admin_liga_process_daily", cerrar: "admin_liga_process_close",
  };
  return claves[id] ?? id;
}

export function pasoClave(paso: "foto" | "formar" | "cerrar") {
  return { foto: "admin_liga_step_photo", formar: "admin_liga_step_form", cerrar: "admin_liga_step_close" }[paso];
}

export type Pendiente = {
  seccion: "jornadas" | "revisar" | "premio" | "coste" | "consultas";
  cuantos: number;
} & (
  | { tipo: "proceso_fallido"; datos: { proceso: string; cuando: string } }
  | { tipo: "revisar"; datos: { errores: number; reportes: number; desde: string | null } }
  | { tipo: "premio"; datos: { temporada: string } }
  | { tipo: "tope_ia"; datos: { usado_pct: number; aviso_pct: number } }
  | { tipo: "altas_sin_estrategia"; datos: { dias: number } }
);

export function textoPendiente(p: Pendiente, proceso: (id: string) => string): { clave: string; valores: Record<string, string | number> } {
  switch (p.tipo) {
    case "proceso_fallido": return { clave: "admin_resumen_fallido", valores: { proceso: proceso(p.datos.proceso) } };
    case "revisar": return { clave: "admin_resumen_revisar", valores: { errores: p.datos.errores, reportes: p.datos.reportes } };
    case "premio": return { clave: "admin_resumen_premio", valores: { temporada: p.datos.temporada } };
    case "tope_ia": return { clave: "admin_resumen_tope", valores: { usado: p.datos.usado_pct, aviso: p.datos.aviso_pct } };
    case "altas_sin_estrategia": return { clave: "admin_resumen_altas", valores: { cuantos: p.cuantos, dias: p.datos.dias } };
  }
}
