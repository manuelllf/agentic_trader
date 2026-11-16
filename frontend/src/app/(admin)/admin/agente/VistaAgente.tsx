"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Celda, Grupo, Hoja } from "../_panel/ui";
import { Carga, TextoAgente } from "./Comun";
import { fecha } from "./formato";
import type { AgenteVista } from "./tipos";
import { useCarga } from "./useCarga";

type Traducir = ReturnType<typeof useTranslations>;

// Los motivos que pone el código se traducen; los que escriba el agente se muestran tal cual.
const MOTIVOS = new Set(["nacimiento", "renacimiento"]);
const motivoLegible = (motivo: string, t: Traducir) => (MOTIVOS.has(motivo) ? t(`pnl_agente_pb_motivo_${motivo}`) : motivo);

function Filosofia({ a, abierta, onCerrar, t, locale }: { a: AgenteVista; abierta: boolean; onCerrar: () => void; t: Traducir; locale: string }) {
  return (
    <Hoja abierta={abierta} titulo={t("pnl_agente_ag_filosofia")} accion={t("admin_pnl_listo")} onCerrar={onCerrar}>
      <div className="pa-hoja">
        {a.filosofia && <TextoAgente texto={a.filosofia.contenido} />}
        <Grupo cabecera={t("pnl_agente_ag_versiones")}>
          {a.versiones.map(v => (
            <Celda key={v.version} titulo={t("pnl_agente_ag_version", { version: v.version })}
              subtitulo={v.motivo ? motivoLegible(v.motivo, t) : undefined}
              valor={`${t(`pnl_agente_pb_${v.estado}`)}${v.adoptada_en ? ` · ${fecha(v.adoptada_en, locale)}` : ""}`} />
          ))}
        </Grupo>
      </div>
    </Hoja>
  );
}

function Contenido({ a, locale, t }: { a: AgenteVista; locale: string; t: Traducir }) {
  const [filosofia, setFilosofia] = useState(false);
  return (
    <div className="pa-agente">
      <Grupo cabecera={t("pnl_agente_ag_vigila_cab")}>
        {a.seguimiento.length > 0 ? a.seguimiento.map(s => (
          <Celda key={s.id} titulo={s.ticker} subtitulo={s.motivo} valor={t("pnl_agente_ag_desde", { fecha: fecha(s.desde, locale) })}
            href={`/admin/agente/fichas/${encodeURIComponent(s.ticker)}`} />
        )) : <Celda titulo={t("pnl_agente_ag_seguimiento_vacio")} subtitulo={t("pnl_agente_ag_seguimiento_vacio_texto")} />}
      </Grupo>
      <Grupo cabecera={t("pnl_agente_ag_fichas_cab")}>
        {a.fichas.length > 0 ? a.fichas.map(f => (
          <Celda key={f.ticker} titulo={f.ticker} href={`/admin/agente/fichas/${encodeURIComponent(f.ticker)}`}
            subtitulo={t("pnl_agente_ag_ficha_sub", { certeza: t(`pnl_agente_certeza_${f.certeza}`), version: f.version })}
            valor={fecha(f.actualizada, locale)} />
        )) : <Celda titulo={t("pnl_agente_ag_fichas_vacio")} />}
      </Grupo>
      <Grupo cabecera={t("pnl_agente_ag_piensa_cab")}>
        {a.filosofia ? (
          <Celda titulo={t("pnl_agente_ag_filosofia")} subtitulo={t("pnl_agente_ag_version", { version: a.filosofia.version })} onClick={() => setFilosofia(true)} />
        ) : <Celda titulo={t("pnl_agente_ag_filosofia_vacio")} subtitulo={t("pnl_agente_ag_filosofia_vacio_texto")} />}
        <Celda titulo={t("pnl_agente_ag_diario")} subtitulo={t("pnl_agente_ag_diario_sub")} href="/admin/agente/diario" />
      </Grupo>
      <Grupo cabecera={t("pnl_agente_ag_lecciones_cab")} pie={t("pnl_agente_ag_lecciones_pie")}>
        {a.lecciones.length > 0 ? a.lecciones.map(l => (
          <Celda key={l.id} titulo={l.texto} subtitulo={fecha(l.creado, locale)} />
        )) : <Celda titulo={t("pnl_agente_ag_lecciones_vacio")} />}
      </Grupo>
      <Filosofia a={a} abierta={filosofia} onCerrar={() => setFilosofia(false)} t={t} locale={locale} />
    </div>
  );
}

export default function VistaAgente() {
  const t = useTranslations();
  const locale = useLocale();
  const carga = useCarga<AgenteVista>("/v1/agente");
  return <Carga {...carga} filas={5}>{a => <Contenido a={a} locale={locale} t={t} />}</Carga>;
}
