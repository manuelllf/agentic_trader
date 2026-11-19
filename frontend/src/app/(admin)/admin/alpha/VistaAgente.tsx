"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Celda, Grupo, Hoja } from "../_panel/ui";
import { Carga, TextoAgente } from "./Comun";
import { fecha } from "./formato";
import type { AgenteVista } from "./tipos";
import { useCarga } from "./useCarga";

type Traducir = ReturnType<typeof useTranslations>;
type Abierta = "filosofia" | "fichas" | "lecciones" | null;

// Los motivos que pone el código se traducen; los que escriba el agente se muestran tal cual.
const MOTIVOS = new Set(["nacimiento", "renacimiento"]);
const motivoLegible = (motivo: string, t: Traducir) => (MOTIVOS.has(motivo) ? t(`pnl_agente_pb_motivo_${motivo}`) : motivo);

function Contenido({ a, locale, t }: { a: AgenteVista; locale: string; t: Traducir }) {
  const [abierta, setAbierta] = useState<Abierta>(null);
  const cerrar = () => setAbierta(null);
  const titulo = abierta === "filosofia" ? t("pnl_agente_ag_filosofia") : abierta === "fichas" ? t("pnl_agente_ag_fichas_cab") : t("pnl_agente_ag_lecciones_cab");
  return (
    <div className="pa-agente">
      <Grupo cabecera={t("pnl_agente_ag_piensa_cab")}>
        {a.filosofia ? (
          <Celda titulo={t("pnl_agente_ag_filosofia")} subtitulo={t("pnl_agente_ag_version", { version: a.filosofia.version })} onClick={() => setAbierta("filosofia")} />
        ) : <Celda titulo={t("pnl_agente_ag_filosofia_vacio")} subtitulo={t("pnl_agente_ag_filosofia_vacio_texto")} />}
        <Celda titulo={t("pnl_agente_cmt_titulo")} subtitulo={t("pnl_agente_ag_trabaja_sub")} href="/admin/alpha/como-trabaja" />
      </Grupo>
      <Grupo cabecera={t("pnl_agente_ag_vigila_cab")}>
        <Celda titulo={t("pnl_agente_seg_titulo")} valor={String(a.seguimiento.length)} href="/admin/alpha/seguimiento" />
        <Celda titulo={t("pnl_agente_ag_fichas_cab")} subtitulo={a.fichas.length ? undefined : t("pnl_agente_ag_fichas_vacio")}
          valor={String(a.fichas.length)} onClick={a.fichas.length ? () => setAbierta("fichas") : undefined} />
      </Grupo>
      <Grupo cabecera={t("pnl_agente_ag_aprendido_cab")} pie={t("pnl_agente_ag_lecciones_pie")}>
        <Celda titulo={t("pnl_agente_ag_lecciones_cab")} subtitulo={a.lecciones.length ? undefined : t("pnl_agente_ag_lecciones_vacio")}
          valor={String(a.lecciones.length)} onClick={a.lecciones.length ? () => setAbierta("lecciones") : undefined} />
      </Grupo>
      <Grupo>
        <Celda titulo={t("pnl_agente_decs_buscar")} href="/admin/alpha/decisiones?buscar=1" />
      </Grupo>
      <Hoja abierta={abierta !== null} titulo={titulo} accion={t("admin_pnl_listo")} onCerrar={cerrar}>
        <div className="pa-hoja pa-vista">
          {abierta === "filosofia" && (
            <>
              {a.filosofia && <TextoAgente texto={a.filosofia.contenido} />}
              <Grupo cabecera={t("pnl_agente_ag_versiones")}>
                {a.versiones.map(v => (
                  <Celda key={v.version} titulo={t("pnl_agente_ag_version", { version: v.version })}
                    subtitulo={v.motivo ? motivoLegible(v.motivo, t) : undefined}
                    valor={`${t(`pnl_agente_pb_${v.estado}`)}${v.adoptada_en ? ` · ${fecha(v.adoptada_en, locale)}` : ""}`} />
                ))}
              </Grupo>
            </>
          )}
          {abierta === "fichas" && (
            <Grupo>
              {a.fichas.map(f => (
                <Celda key={f.ticker} titulo={f.ticker} href={`/admin/alpha/fichas/${encodeURIComponent(f.ticker)}`}
                  subtitulo={t("pnl_agente_ag_ficha_sub", { certeza: t(`pnl_agente_certeza_${f.certeza}`), version: f.version })}
                  valor={fecha(f.actualizada, locale)} />
              ))}
            </Grupo>
          )}
          {abierta === "lecciones" && (
            <Grupo pie={t("pnl_agente_ag_lecciones_pie")}>
              {a.lecciones.map(l => <Celda key={l.id} titulo={l.texto} subtitulo={fecha(l.creado, locale)} />)}
            </Grupo>
          )}
        </div>
      </Hoja>
    </div>
  );
}

export default function VistaAgente() {
  const t = useTranslations();
  const locale = useLocale();
  const carga = useCarga<AgenteVista>("/v1/agente");
  return <Carga {...carga} filas={5}>{a => <Contenido a={a} locale={locale} t={t} />}</Carga>;
}
