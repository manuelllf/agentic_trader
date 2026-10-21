// Tipos de la API del panel de usuarios y utilidades comunes. Dinero: la API lo manda como texto.
export const FILTROS = ["todas", "activas", "suspendidas", "mayores18"] as const;
export type Filtro = (typeof FILTROS)[number];

export const ORDENES = ["ultima_actividad", "creado", "visitas_7d", "ia_mes_usd"] as const;
export type Orden = (typeof ORDENES)[number];

export type Dinero = string;

export type FilaPanel = {
  id: string; alias: string; oculto: boolean; creado: string; roles: string[];
  suspendido: boolean; pro: boolean; visitas_total: number; visitas_7d: number;
  ultima_actividad: string | null; ia_mes_usd: Dinero;
};
export type ListaPanel = { total: number; filas: FilaPanel[] };

export type ResumenPanel = {
  cuentas: number; nuevas_7d: number; activas_7d: number; visitas_7d: number;
  pro_vigentes: number; pases_vigentes: number; ia_mes_usd: Dinero;
  cobrado_mes_usd: Dinero; tope_mensual_usd: Dinero | null;
};

export type FichaPanel = {
  id: string; alias: string; email: string | null; oculto: boolean; creado: string;
  roles: string[]; suspendido: boolean; plan: "gratis" | "pro"; plan_hasta: string | null;
  pase_liga: boolean; pase_hasta: string | null; saldo: Dinero;
  edad: number | null; edad_declarada_en: string | null; baja_solicitada: string | null;
  terminos: { version: string; aceptado: boolean; aceptado_en: string | null };
  actividad: {
    visitas_total: number; visitas_7d: number; ultima_visita: string | null;
    ultima_actividad: string | null; tiempo_30d_seg: number;
  };
  ia: {
    mes: {
      total_usd: Dinero; llamadas: number; cache: number;
      conversor_usd: Dinero; conversor_llamadas: number;
      pregunta_usd: Dinero; pregunta_llamadas: number; cobrado_pregunta_usd: Dinero;
      lectura_usd: Dinero; lectura_llamadas: number; cobrado_lectura_usd: Dinero;
      cobrado_usd: Dinero;
    };
    historico_usd: Dinero;
  };
  liga: {
    estrategias: number; estrategias_jugando: number; inscripciones: number;
    ligas_propias: number; ligas_miembro: number; reportes_hechos: number;
    reportes_recibidos: number;
  };
};

export type DiasPanel = { dias: { dia: string; visitas: number }[] };

export function esFiltro(valor: string | null): valor is Filtro {
  return FILTROS.includes(valor as Filtro);
}

export function esOrden(valor: string | null): valor is Orden {
  return ORDENES.includes(valor as Orden);
}

// Mismo formato que la página de coste del mes: dólares con 4 decimales.
export function formatoUsd(locale: string): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, {
    style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4,
  });
}

export function horasMinutos(segundos: number): { horas: number; minutos: number } {
  const total = Math.max(0, Math.floor(segundos));
  return { horas: Math.floor(total / 3600), minutos: Math.floor((total % 3600) / 60) };
}
