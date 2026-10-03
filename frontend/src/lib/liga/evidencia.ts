export type ReglaVerificada = {
  clave: string;
  titulo: string;
  cumple: boolean | null;
  motivo: string | null;
};

export type EvidenciaFormacion = {
  formacion: {
    inscripcion_id: number;
    jornada_id: number;
    jornada_numero: number;
    desde: string;
    hasta: string;
    metodo: "seleccion" | "mantenida";
    receta_id: number | null;
    receta_vigente: boolean;
    estado_foto: "disponible" | "sin_datos";
    estado_reglas: "disponible" | "sin_datos" | "version_no_soportada";
    idea: string | null;
    pregunta: string | null;
    pesos: Record<string, number> | null;
    reglas: { clave: string; titulo: string; detalle: string }[];
    n_empresas: number | null;
    reparto: string | null;
    max_por_sector: number | null;
  };
  posiciones: {
    ticker: string;
    peso: number;
    origen: "seleccion" | "mantenida";
    reglas: ReglaVerificada[];
    rendimiento: {
      estado: "disponible" | "sin_datos";
      desde: string;
      hasta: string | null;
      rentabilidad_pct: number | null;
      sp500_pct: number | null;
      diferencia_pp: number | null;
      incompleta: boolean;
    };
  }[];
  cambios: {
    desde_inscripcion_id: number | null;
    metodologia_cambio: boolean | null;
    entradas: string[];
    salidas: {
      ticker: string;
      causa: "metodologia_cambiada" | "regla_no_cumplida" | "sigue_elegible_sin_entrar" | "no_disponible" | "excluida_manual";
      reglas: ReglaVerificada[];
    }[];
  } | null;
};
