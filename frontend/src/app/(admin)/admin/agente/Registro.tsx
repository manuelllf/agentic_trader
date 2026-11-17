"use client";

import { useLocale, useTranslations } from "next-intl";
import { Celda, Grupo, Vacio } from "../_panel/ui";
import { Carga, Pagina } from "./Comun";
import { nombreEvento, subEvento } from "./Dia";
import { horaNY } from "./formato";
import { diaLargo } from "./textos";
import type { Dia } from "./tipos";
import { useCarga } from "./useCarga";

/** Registro de un día del agente en lenguaje normal, lo último arriba. */
export default function Registro({ fecha }: { fecha: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(fecha);
  const carga = useCarga<Dia>(valida ? `/v1/dia/${fecha}` : null);
  return (
    <Pagina atras="/admin/agente">
      {!valida ? <Vacio titulo={t("pnl_agente_reg_no_valida")} /> : (
        <>
          <h2 className="pa-h1">{diaLargo(fecha, locale)}</h2>
          <p className="pa-meta">{t("pnl_agente_reg_meta")}</p>
          <Carga {...carga} filas={6}>
            {dia => dia.eventos.length ? (
              <Grupo>
                {[...dia.eventos].reverse().map(e => {
                  const { sub, mal } = subEvento(e, dia, t, locale);
                  const id = e.tipo === "decision" ? Number(e.datos.decision_id) : null;
                  return <Celda key={e.id} titulo={nombreEvento(e.tipo, t)} valor={horaNY(e.ocurrido, locale)}
                    subtitulo={sub ? (mal ? <span className="pa-fallo">{sub}</span> : sub) : undefined}
                    href={id ? `/admin/agente/decisiones/${id}` : undefined} />;
                })}
              </Grupo>
            ) : <Vacio titulo={t("pnl_agente_dia_sin_eventos")} />}
          </Carga>
        </>
      )}
    </Pagina>
  );
}
