"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { porcentajeConSigno } from "../_marco/formato";
import { Celda, Datos, Grupo, Hoja } from "../_panel/ui";
import { HERRAMIENTAS, LIMITES, MAX_VUELTAS } from "./catalogo";
import { Pagina } from "./Comun";
import { HojaCompartir, imagenPasos } from "./Compartir";
import { CabeceraCompartir, Flujo, type Paso } from "./Flujo";
import { horaNY } from "./formato";
import type { AgenteVista, Hoy, Tarea } from "./tipos";
import { useCarga } from "./useCarga";

const PASOS = ["datos", "vigia", "agente", "limites", "revisor", "ordenes", "memoria"] as const;
type Clave = (typeof PASOS)[number];
// La hora de cada paso es la de su tarea en el programa del día (config del servicio).
const TAREA_DE: Partial<Record<Clave, Tarea>> = { datos: "preparacion", ordenes: "ejecucion", memoria: "consolidacion" };

/** Del cierre a la orden: los siete pasos de cada día de bolsa, con las horas y los límites reales. */
export default function ComoTrabaja() {
  const t = useTranslations();
  const locale = useLocale();
  const hoy = useCarga<Hoy>("/v1/hoy");
  const agente = useCarga<AgenteVista>("/v1/agente");
  const [detalle, setDetalle] = useState<Clave | null>(null);
  const [compartir, setCompartir] = useState(false);
  const empresas = agente.datos?.seguimiento.length;
  const hora = (k: Clave) => {
    const tarea = TAREA_DE[k];
    const d = tarea && hoy.datos?.despertares.find(x => x.tarea === tarea);
    return d ? horaNY(d.hora, locale) : undefined;
  };
  const sub = (k: Clave) => t(`pnl_agente_cmt_${k}_sub`, { n: empresas ?? "…", vueltas: MAX_VUELTAS, herramientas: HERRAMIENTAS.length });
  const pasos: Paso[] = PASOS.map(k => ({ clave: k, titulo: t(`pnl_agente_cmt_${k}`), sub: sub(k), valor: hora(k), estado: "fijo", onClick: () => setDetalle(k) }));
  const crear = () => imagenPasos(t("pnl_agente_cmt_imagen_titulo"), t("pnl_agente_cmt_imagen_sub"),
    PASOS.map(k => ({ titulo: t(`pnl_agente_cmt_${k}`), sub: sub(k), valor: hora(k), estado: "fijo" as const })), t("pnl_agente_imagen_pie"));
  const pct = (v: number) => porcentajeConSigno(v, locale, 0);

  const cuerpos: Record<Clave, () => ReactNode> = {
    datos: () => (
      <Grupo pie={t("pnl_agente_cmt_datos_pie")}>
        <Celda titulo={t("pnl_agente_cmt_que")} subtitulo={t("pnl_agente_cmt_datos_que", { n: empresas ?? "…" })} />
        <Celda titulo={t("pnl_agente_cmt_cuando")} valor={hora("datos")} />
        <Celda titulo={t("pnl_agente_cmt_fuente")} valor="Yahoo Finance" />
      </Grupo>
    ),
    vigia: () => (
      <Grupo cabecera={t("pnl_agente_cmt_vigia_cab")}>
        <Celda titulo={t("pnl_agente_cmt_vigia_diaria")} subtitulo={t("pnl_agente_cmt_vigia_diaria_sub")} />
        <Celda titulo={t("pnl_agente_cmt_vigia_alertas")} subtitulo={t("pnl_agente_cmt_vigia_alertas_sub")} />
        <Celda titulo={t("pnl_agente_cmt_vigia_extendido")} subtitulo={t("pnl_agente_cmt_vigia_extendido_sub")} />
        <Celda titulo={t("pnl_agente_cmt_vigia_propios")} subtitulo={t("pnl_agente_cmt_vigia_propios_sub")} />
      </Grupo>
    ),
    agente: () => (
      <>
        <Grupo cabecera={t("pnl_agente_cmt_herramientas", { n: HERRAMIENTAS.length })} pie={t("pnl_agente_cmt_agente_pie")}>
          {HERRAMIENTAS.map(h => <Celda key={h} titulo={<span className="pa-codigo">{h}</span>} />)}
        </Grupo>
        <Datos items={[{ etiqueta: t("pnl_agente_cmt_vueltas"), valor: t("pnl_agente_cmt_hasta", { n: MAX_VUELTAS }) }, { etiqueta: t("pnl_agente_cmt_modelo"), valor: "DeepSeek" }]} />
      </>
    ),
    limites: () => (
      <>
        <Grupo cabecera={t("pnl_agente_cmt_siempre")}>
          <Celda titulo={t("pnl_agente_cmt_lim_posiciones")} valor={t("pnl_agente_cmt_como_maximo", { v: LIMITES.posiciones })} />
          <Celda titulo={t("pnl_agente_cmt_lim_peso")} valor={t("pnl_agente_cmt_como_maximo", { v: `${LIMITES.pesoCompra} %` })} />
          <Celda titulo={t("pnl_agente_cmt_lim_defensivo")} valor={t("pnl_agente_cmt_como_maximo", { v: `${LIMITES.pesoDefensivo} %` })} />
          <Celda titulo={t("pnl_agente_cmt_lim_revision")} subtitulo={t("pnl_agente_cmt_lim_revision_sub", { peso: LIMITES.pesoRevision, caida: Math.abs(LIMITES.caidaPosicion) })} />
          <Celda titulo={t("pnl_agente_cmt_lim_resultados")} subtitulo={t("pnl_agente_cmt_lim_resultados_sub", { n: LIMITES.diasAntesDeEvento })} />
          <Celda titulo={t("pnl_agente_cmt_lim_apertura")} subtitulo={t("pnl_agente_cmt_lim_apertura_sub", { n: LIMITES.aperturaSobreCierre })} />
        </Grupo>
        <Grupo cabecera={t("pnl_agente_cmt_cartera")} pie={t("pnl_agente_cmt_limites_pie")}>
          <Celda titulo={t("pnl_agente_modo_defensivo")} valor={t("pnl_agente_cmt_desde_maximo", { v: pct(LIMITES.caidaDefensiva) })} />
          <Celda titulo={t("pnl_agente_modo_pausa")} valor={t("pnl_agente_cmt_desde_maximo", { v: pct(LIMITES.caidaPausa) })} />
          <Celda titulo={t("pnl_agente_cmt_presupuesto")} valor={t("pnl_agente_cmt_al_mes", { v: LIMITES.presupuestoMes })} />
        </Grupo>
      </>
    ),
    revisor: () => (
      <Grupo cabecera={t("pnl_agente_cmt_puede")} pie={t("pnl_agente_cmt_revisor_pie")}>
        <Celda titulo={t("pnl_agente_ver_aprobada")} subtitulo={t("pnl_agente_cmt_aprobar_sub")} />
        <Celda titulo={t("pnl_agente_cmt_corregir")} subtitulo={t("pnl_agente_cmt_corregir_sub")} />
        <Celda titulo={t("pnl_agente_ver_rechazada")} subtitulo={t("pnl_agente_cmt_rechazar_sub")} />
      </Grupo>
    ),
    ordenes: () => (
      <Grupo>
        <Celda titulo={t("pnl_agente_cmt_precio")} subtitulo={t("pnl_agente_cmt_precio_sub", { n: LIMITES.aperturaSobreCierre })} />
        <Celda titulo={t("pnl_agente_cmt_cuando")} valor={hora("ordenes")} />
        <Celda titulo={t("pnl_agente_dec_en_sombra")} subtitulo={t("pnl_agente_cmt_sombra_sub")} />
      </Grupo>
    ),
    memoria: () => (
      <Grupo>
        <Celda titulo={t("pnl_agente_ag_lecciones_cab")} subtitulo={t("pnl_agente_cmt_lecciones_sub")} />
        <Celda titulo={t("pnl_agente_ag_fichas_cab")} subtitulo={t("pnl_agente_cmt_fichas_sub")} />
        <Celda titulo={t("pnl_agente_cmt_filosofia")} subtitulo={t("pnl_agente_cmt_filosofia_sub")} />
      </Grupo>
    ),
  };

  return (
    <Pagina atras="/admin/agente?v=agente">
      <h2 className="pa-h1">{t("pnl_agente_cmt_titulo")}</h2>
      <p className="pa-meta">{t("pnl_agente_cmt_meta")}</p>
      <CabeceraCompartir titulo={t("pnl_agente_cmt_cab")} onCompartir={() => setCompartir(true)} />
      <Flujo pasos={pasos} />
      <Hoja abierta={Boolean(detalle)} titulo={detalle ? t(`pnl_agente_cmt_${detalle}`) : ""} accion={t("admin_pnl_listo")} onCerrar={() => setDetalle(null)}>
        {detalle && <div className="pa-hoja pa-vista">{cuerpos[detalle]()}</div>}
      </Hoja>
      <HojaCompartir abierta={compartir} crear={crear} nombre="alphagentic-como-trabaja" alt={t("pnl_agente_cmt_titulo")} onCerrar={() => setCompartir(false)} />
    </Pagina>
  );
}
