"use client";

import { useLocale, useTranslations } from "next-intl";
import { Celda, Grupo, Vacio } from "../_panel/ui";
import { AgenteError } from "./api";
import { Carga, Pagina, TextoAgente } from "./Comun";
import { dinero, fecha, legible } from "./formato";
import type { DecisionDetalle, OperacionPropuesta } from "./tipos";
import { useCarga } from "./useCarga";

type Traducir = ReturnType<typeof useTranslations>;

function Operacion({ o, locale, t }: { o: OperacionPropuesta; locale: string; t: Traducir }) {
  const campos: [string, string | undefined][] = [
    ["pnl_agente_dec_tesis", o.tesis], ["pnl_agente_dec_supuestos", o.supuestos], ["pnl_agente_dec_salidas", o.salidas],
    ["pnl_agente_dec_ruptura", o.ruptura], ["pnl_agente_dec_prevision", o.prevision_12m],
  ];
  const cantidad = o.importe ? dinero(o.importe, locale) : o.acciones ? t("pnl_agente_dec_acciones", { n: Number(o.acciones) }) : undefined;
  return (
    <Grupo cabecera={`${t(`pnl_agente_lado_${o.lado}`)} ${o.ticker}`}>
      {cantidad && <Celda titulo={t("pnl_agente_dec_cantidad")} valor={cantidad} />}
      {campos.filter(([, v]) => v).map(([k, v]) => <Celda key={k} titulo={t(k)} subtitulo={v} />)}
      {o.proximo_evento && <Celda titulo={t("pnl_agente_dec_evento")} valor={fecha(o.proximo_evento, locale)} />}
    </Grupo>
  );
}

export default function Decision({ id }: { id: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const carga = useCarga<DecisionDetalle>(`/v1/decisiones/${encodeURIComponent(id)}`);
  const noExiste = carga.error instanceof AgenteError && carga.error.estado === 404;

  return (
    <Pagina atras="/admin/agente">
      {noExiste ? <Vacio titulo={t("pnl_agente_dec_no_existe")} /> : (
        <Carga {...carga} filas={5}>
          {d => {
            const violaciones = (d.propuesta.violaciones ?? []).map(v => typeof v === "string" ? v : v.mensaje ?? v.codigo ?? "").filter(Boolean);
            return (
              <>
                <p className="pa-meta">{fecha(d.fecha_ny, locale)} · {t(`pnl_agente_dec_tipo_${d.tipo}`)}{d.sombra ? ` · ${t("pnl_agente_dec_en_sombra")}` : ""}</p>
                <TextoAgente texto={d.razonamiento} />
                <Grupo cabecera={t("pnl_agente_dec_revisor")}>
                  <Celda titulo={t("pnl_agente_dec_veredicto")} valor={d.revisor_veredicto ? t(`pnl_agente_ver_${d.revisor_veredicto}`) : t("pnl_agente_dec_sin_revisor")}
                    subtitulo={d.revisor_motivo ?? undefined} />
                </Grupo>
                {(d.propuesta.operaciones ?? []).map((o, i) => <Operacion key={i} o={o} locale={locale} t={t} />)}
                {violaciones.length > 0 && (
                  <Grupo cabecera={t("pnl_agente_dec_violaciones")}>{violaciones.map((v, i) => <Celda key={i} titulo={v} />)}</Grupo>
                )}
                {d.ordenes.length > 0 && (
                  <Grupo cabecera={t("pnl_agente_dec_ordenes")}>
                    {d.ordenes.map(o => (
                      <Celda key={o.id} titulo={`${t(`pnl_agente_lado_${o.lado}`)} ${o.ticker}`} valor={legible(o.estado)}
                        subtitulo={o.precio ? t("pnl_agente_dec_ejecutada", { n: Number(o.acciones_ejecutadas ?? 0), precio: dinero(o.precio, locale) }) : o.motivo ?? undefined} />
                    ))}
                  </Grupo>
                )}
                {d.previsiones.length > 0 && (
                  <Grupo cabecera={t("pnl_agente_dec_previsiones")}>
                    {d.previsiones.map((p, i) => <Celda key={i} titulo={p.ticker ?? ""} subtitulo={p.texto} />)}
                  </Grupo>
                )}
                <p className="pnl-pie-grupo">{t("pnl_agente_dec_pie", { modelo: d.modelo })}</p>
              </>
            );
          }}
        </Carga>
      )}
    </Pagina>
  );
}
