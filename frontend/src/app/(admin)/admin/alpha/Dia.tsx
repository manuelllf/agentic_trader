"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Celda, Datos, Grupo, Hoja } from "../_panel/ui";
import { Horas } from "./Comun";
import { Flujo, type Paso } from "./Flujo";
import { horasNYyES, legible } from "./formato";
import { diaCorto, subDecision, tituloDecision, type Traducir } from "./textos";
import type { Dia, EjecucionTarea, EventoDia, ResumenDecision, Tarea } from "./tipos";

const ORDEN_TAREAS: Tarea[] = ["vigia_previo", "ejecucion", "preparacion", "despertar", "consolidacion"];
const MAX_MOTIVO = 120;

const primeraParte = (s: unknown, max = 90) => String(s ?? "").split(";")[0].slice(0, max);

/** Nombre de un evento del registro en lenguaje normal; los que no tienen texto se leen tal cual. */
export const nombreEvento = (tipo: string, t: Traducir) => (t.has(`pnl_agente_ev_${tipo}`) ? t(`pnl_agente_ev_${tipo}`) : legible(tipo));

function decisionDe(e: EventoDia, dia: Dia): ResumenDecision | undefined {
  const id = Number(e.datos.decision_id);
  return dia.decisiones.find(d => d.id === id);
}

/** La línea de debajo de un evento del registro. */
export function subEvento(e: EventoDia, dia: Dia, t: Traducir, locale: string): { sub: string; mal: boolean } {
  if (e.tipo === "decision") {
    const d = decisionDe(e, dia);
    return { sub: d ? subDecision(d, t, tituloDecision(d.operaciones, d.tipo, t, locale)) : "", mal: false };
  }
  if (e.tipo === "ciclo_fallido") return { sub: primeraParte(e.datos.motivo), mal: true };
  return { sub: t.has(`pnl_agente_origen_${e.origen}`) ? t(`pnl_agente_origen_${e.origen}`) : e.origen, mal: false };
}

/** Qué dejó hecho cada tarea, dicho en corto con lo que guardó. */
function subTarea(tarea: Tarea, ej: EjecucionTarea, evs: EventoDia[], dia: Dia, t: Traducir, locale: string): { sub: string; mal: boolean } {
  if (ej.estado === "fallida") return { sub: primeraParte(ej.error) || t("pnl_agente_flujo_fallo"), mal: true };
  const tipo = (x: string) => evs.find(e => e.tipo === x);
  switch (tarea) {
    case "vigia_previo": {
      const p = tipo("premarket");
      if (p) return { sub: t("pnl_agente_dia_premarket", { n: Number(p.datos.movimientos ?? 0) }), mal: false };
      return { sub: tipo("vigia_previo_sin_fuente") ? t("pnl_agente_ev_vigia_previo_sin_fuente") : t("pnl_agente_dia_s_vigia_previo"), mal: false };
    }
    case "ejecucion":
      return { sub: dia.ordenes_ejecutadas ? t("pnl_agente_dia_ejecutadas", { n: dia.ordenes_ejecutadas }) : t("pnl_agente_dia_sin_ordenes"), mal: false };
    case "preparacion": {
      const p = tipo("preparacion");
      if (!p) return { sub: t("pnl_agente_dia_s_preparacion"), mal: false };
      const empresas = Number(p.datos.empresas ?? 0);
      return { sub: empresas ? t("pnl_agente_dia_preparadas", { n: Number(p.datos.fundamentales ?? 0), total: empresas }) : t("pnl_agente_dia_sin_empresas"), mal: false };
    }
    case "despertar": {
      const ds = evs.filter(e => e.tipo === "decision").map(e => decisionDe(e, dia)).filter((d): d is ResumenDecision => Boolean(d));
      const ult = ds.sort((a, b) => b.id - a.id)[0];
      if (ult) return { sub: `${tituloDecision(ult.operaciones, ult.tipo, t, locale)} · ${ult.sombra ? t("pnl_agente_dec_en_sombra").toLocaleLowerCase(locale) : ult.veredicto ? t(`pnl_agente_ver_${ult.veredicto}`) : t("pnl_agente_dec_sin_revisor")}`, mal: false };
      if (tipo("ia_apagada")) return { sub: t("pnl_agente_ev_ia_apagada"), mal: false };
      return { sub: t("pnl_agente_dia_s_despertar"), mal: false };
    }
    case "consolidacion": {
      const c = tipo("consolidacion");
      return { sub: c && !c.datos.lecciones_aprobadas ? t("pnl_agente_dia_sin_lecciones") : t("pnl_agente_dia_s_consolidacion"), mal: false };
    }
  }
}

type Detalle = { tipo: "tarea"; ej: EjecucionTarea } | { tipo: "prevista"; tarea: Tarea; hora: string };

/** Las tareas del día como pasos con pista, cada una con su hoja de detalle. */
export function useTareasDelDia(dia: Dia | null) {
  const t = useTranslations();
  const locale = useLocale();
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  if (!dia) return { pasos: [] as Paso[], hoja: null };
  const ahora = Date.now();
  const tareas = ORDEN_TAREAS.filter(x => dia.programa.some(p => p.tarea === x) || dia.ejecuciones.some(e => e.tarea === x));
  const pasos: Paso[] = tareas.map(tarea => {
    const ej = dia.ejecuciones.filter(e => e.tarea === tarea).at(-1);
    const p = dia.programa.find(x => x.tarea === tarea);
    const titulo = t(`pnl_agente_dia_t_${tarea}`);
    if (ej) {
      const { sub, mal } = subTarea(tarea, ej, dia.eventos.filter(e => e.ejecucion_id === ej.id), dia, t, locale);
      const estado = ej.estado === "fallida" ? "fallo" : ej.estado === "hecha" ? "hecho" : "curso";
      return { clave: tarea, titulo, sub, subMal: mal, estado, onClick: () => setDetalle({ tipo: "tarea", ej }),
        valor: estado === "curso" ? t("pnl_agente_flujo_curso") : <Horas iso={ej.terminada ?? ej.empezada} />,
        valorTexto: estado === "curso" ? t("pnl_agente_flujo_curso") : horasNYyES(ej.terminada ?? ej.empezada, locale) };
    }
    const llego = p ? Date.parse(p.hora) <= ahora : false;
    return { clave: tarea, titulo, sub: t(`pnl_agente_dia_s_${tarea}`), estado: llego ? "curso" : "pendiente",
      valor: p ? <Horas iso={p.hora} /> : undefined, valorTexto: p ? horasNYyES(p.hora, locale) : undefined, onClick: p ? () => setDetalle({ tipo: "prevista", tarea, hora: p.hora }) : undefined };
  });

  const cuerpo = () => {
    if (!detalle) return null;
    if (detalle.tipo === "prevista") {
      const pendiente = Date.parse(detalle.hora) > ahora;
      return (
        <Grupo pie={t("pnl_agente_dia_prevista_pie")}>
          <Celda titulo={t("pnl_agente_dia_prevista")} subtitulo={diaCorto(dia.fecha, locale)} valor={<Horas iso={detalle.hora} />} />
          <Celda titulo={t("pnl_agente_dia_estado")} valor={t(pendiente ? "pnl_agente_flujo_pendiente" : "pnl_agente_flujo_curso")} />
        </Grupo>
      );
    }
    const ej = detalle.ej;
    const evs = dia.eventos.filter(e => e.ejecucion_id === ej.id).reverse();
    const prevista = dia.programa.find(p => p.tarea === ej.tarea);
    const ds = evs.filter(e => e.tipo === "decision");
    const fallos = evs.filter(e => e.tipo === "ciclo_fallido");
    return (
      <>
        <Datos items={[
          { etiqueta: t("pnl_agente_dia_prevista"), valor: prevista ? <Horas iso={prevista.hora} /> : "—" },
          { etiqueta: t("pnl_agente_dia_hecha"), valor: <Horas iso={ej.terminada ?? ej.empezada} /> },
        ]} />
        {ds.length > 0 && (
          <Grupo cabecera={t("pnl_agente_dia_decisiones")}>
            {ds.map(e => {
              const d = decisionDe(e, dia);
              return d ? <Celda key={e.id} titulo={tituloDecision(d.operaciones, d.tipo, t, locale)} href={`/admin/alpha/decisiones/${d.id}`}
                subtitulo={subDecision(d, t, horasNYyES(e.ocurrido, locale))} /> : null;
            })}
          </Grupo>
        )}
        {fallos.length > 0 && (
          <Grupo cabecera={t("pnl_agente_dia_fallidos", { n: fallos.length })} pie={t("pnl_agente_dia_fallidos_pie")}>
            {fallos.map(e => <Celda key={e.id} titulo={horasNYyES(e.ocurrido, locale)} subtitulo={<span className="pa-fallo">{primeraParte(e.datos.motivo, MAX_MOTIVO)}</span>} />)}
          </Grupo>
        )}
        <Grupo cabecera={t("pnl_agente_dia_registro_cab")}>
          {evs.length ? evs.map(e => <Celda key={e.id} titulo={nombreEvento(e.tipo, t)} valor={<Horas iso={e.ocurrido} />} />)
            : <Celda titulo={t("pnl_agente_dia_sin_eventos")} />}
        </Grupo>
      </>
    );
  };
  const tituloHoja = detalle ? t(`pnl_agente_dia_s_${detalle.tipo === "tarea" ? detalle.ej.tarea : detalle.tarea}`) : "";
  const hoja = (
    <Hoja abierta={Boolean(detalle)} titulo={tituloHoja} accion={t("admin_pnl_listo")} onCerrar={() => setDetalle(null)}>
      {detalle && <div className="pa-hoja pa-vista">{cuerpo()}</div>}
    </Hoja>
  );
  return { pasos, hoja };
}

export function TareasDelDia({ dia }: { dia: Dia }) {
  const { pasos, hoja } = useTareasDelDia(dia);
  return <>{pasos.length ? <Flujo pasos={pasos} /> : null}{hoja}</>;
}
