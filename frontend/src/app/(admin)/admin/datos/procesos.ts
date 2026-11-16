// Procesos de datos de Vennett > Datos: tipos de lo que cuenta el backend y textos derivados.

export type ProcesoId = "foto" | "global" | "fund" | "fx" | "analitica" | "poda";
export const PROCESOS: readonly ProcesoId[] = ["foto", "global", "fund", "fx", "analitica", "poda"];

export interface EntradaHorario {
  proceso: ProcesoId;
  automatico: boolean;
  dias_semana?: string;
  dia_mes?: string;
  horas?: string;
  minuto?: string;
  zona?: string;
  proxima?: string | null;
}
export interface Horario { scheduler_activo: boolean; procesos: EntradaHorario[] }

export interface EnMarcha {
  /** Un proceso de datos, o `escaneo` si es el de pago de Alpha. */
  id: string;
  desde: string | null;
  progreso?: { hechas: number; total: number; unidad: string | null } | null;
}
export interface EstadoProcesos {
  en_marcha: EnMarcha | null;
  ultima: { analitica: string | null; poda: string | null; global: string | null };
}

// Medido en foto_service: 2 hilos y 0,4 s de pausa, unos 150 nombres por minuto.
export const RITMO_POR_MIN = 150;
export const LIMITE_DEFECTO = 200;

export function minutosCaptura(nombres: number): number {
  return Math.max(1, Math.round(nombres / RITMO_POR_MIN));
}

type T = (clave: string, valores?: Record<string, string | number>) => string;

const ZONAS: Record<string, string> = {
  "America/New_York": "pnl_datos_zona_ny",
  "Europe/Madrid": "pnl_datos_zona_es",
};

/** «De lunes a viernes a las 16:30 y 18:30 (NY)», armado con lo que el scheduler tiene registrado. */
export function textoHorario(id: ProcesoId, e: EntradaHorario | undefined, activo: boolean, t: T, locale: string): string {
  if (id === "fund" || id === "poda") return t("pnl_datos_solo_a_mano");
  if (!e || !e.automatico) return t(activo ? "pnl_datos_sin_trabajo" : "pnl_datos_sin_scheduler");
  const minuto = (e.minuto ?? "0").padStart(2, "0");
  const horasCrudas = (e.horas ?? "*").split(",");
  const horas = horasCrudas.every(h => /^\d{1,2}$/.test(h))
    ? new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(horasCrudas.map(h => `${h.padStart(2, "0")}:${minuto}`))
    : (e.horas ?? "*");
  const cuando = e.dia_mes && e.dia_mes !== "*" ? t("pnl_datos_dia_mes", { dia: e.dia_mes })
    : e.dias_semana === "mon-fri" ? t("pnl_datos_laborables")
    : !e.dias_semana || e.dias_semana === "*" ? t("pnl_datos_cada_dia") : e.dias_semana;
  const zona = e.zona ? (ZONAS[e.zona] ? t(ZONAS[e.zona]) : e.zona) : "";
  return t("pnl_datos_horario", { cuando, horas, zona });
}
