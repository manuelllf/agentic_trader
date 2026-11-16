"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Buscador, Celda, Esqueleto, Grupo, Vacio } from "../_panel/ui";
import { NoDisponible, Pagina } from "./Comun";
import { fecha } from "./formato";
import type { ResumenDecision } from "./tipos";
import { useCarga } from "./useCarga";

const ESPERA_MS = 300;

/** Buscador del diario: pide al servicio cuando la persona deja de escribir. */
export default function Diario() {
  const t = useTranslations();
  const locale = useLocale();
  const [texto, setTexto] = useState("");
  const [consulta, setConsulta] = useState("");
  useEffect(() => {
    const espera = setTimeout(() => setConsulta(texto.trim()), ESPERA_MS);
    return () => clearTimeout(espera);
  }, [texto]);
  const carga = useCarga<{ items: ResumenDecision[] }>(consulta ? `/v1/diario?q=${encodeURIComponent(consulta)}` : null);
  const pendiente = texto.trim() !== consulta || (consulta !== "" && carga.estado === "cargando");

  return (
    <Pagina atras="/admin/agente?v=agente">
      <h2 className="pa-h1">{t("pnl_agente_dia_titulo")}</h2>
      <Buscador valor={texto} onCambio={setTexto} etiqueta={t("pnl_agente_dia_buscar")} placeholder={t("pnl_agente_dia_placeholder")} />
      {consulta === "" && texto.trim() === "" ? (
        <Vacio titulo={t("pnl_agente_dia_inicio_titulo")} texto={t("pnl_agente_dia_inicio_texto")} />
      ) : pendiente ? (
        <Esqueleto filas={3} etiqueta={t("pnl_agente_cargando")} />
      ) : carga.estado === "error" ? (
        <NoDisponible error={carga.error} onReintentar={carga.recargar} />
      ) : carga.datos && carga.datos.items.length === 0 ? (
        <Vacio titulo={t("pnl_agente_dia_nada_titulo", { q: consulta })} texto={t("pnl_agente_dia_nada_texto")} />
      ) : (
        <div className="pa-resultados pnl-llega">
          <Grupo>
            {(carga.datos?.items ?? []).map(d => (
              <Celda key={d.id} titulo={d.razonamiento} href={`/admin/agente/decisiones/${d.id}`}
                subtitulo={`${fecha(d.fecha, locale)} · ${t(`pnl_agente_dec_tipo_${d.tipo}`)}`} />
            ))}
          </Grupo>
        </div>
      )}
    </Pagina>
  );
}
