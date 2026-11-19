"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ApiError, get, getDemoStatus, getEstadoDatos, getFotoStatus, getPodaEstado, getScanReport, getUniversoGlobal,
  getUniversoGlobalSyncEstado, type EstadoDatos, type ScanReport, type UniversoGlobalOpciones,
} from "@/lib/api";
import { dolares, hace, numero } from "../_marco/formato";
import { Celda, Esqueleto, Grupo, Progreso } from "../_panel/ui";
import { HojaProceso, type Accion } from "./HojaProceso";
import { ESCANEO, PROCESOS, type EstadoProcesos, type Horario, type ProcesoId } from "./procesos";
import "./datos.css";

type Texto = (clave: string, valores?: Record<string, string | number>) => string;
interface Aviso { texto: string; malo?: boolean }

/** Cómo terminó un proceso que corre en segundo plano; los demás cuentan su resultado al volver su petición. */
async function resultadoDe(id: string, t: Texto, locale: string): Promise<Aviso | null> {
  if (id === "fund") {
    const s = await getFotoStatus();
    if (s.status === "error") return { texto: s.error ?? t("pnl_datos_fund_fallo"), malo: true };
    const r = s.result;
    if (!r) return null;
    const v = { capturados: numero(r.capturados, locale), pedidos: numero(r.pedidos, locale), sin_datos: numero(r.sin_datos, locale) };
    return r.cortado
      ? { texto: t("pnl_datos_fund_cortada", { ...v, motivo: r.motivo_corte ?? t("pnl_datos_bloqueo") }), malo: true }
      : { texto: t("pnl_datos_fund_hecha", v) };
  }
  if (id === "global") {
    const s = await getUniversoGlobalSyncEstado();
    if (s.status === "error") return { texto: s.error ?? t("pnl_datos_global_fallo"), malo: true };
    if (!s.result) return null;
    return { texto: t(s.result.sin_cambios ? "pnl_datos_global_sin_cambios" : "pnl_datos_global_hecha", { n: numero(s.result.tickers, locale) }) };
  }
  if (id === "escaneo") {
    const s = await getDemoStatus();
    if (s.status === "cancelled") return { texto: t("pnl_datos_esc_cancelado") };
    if (s.status === "error") return { texto: s.error ? `${t("pnl_datos_esc_fallo")} ${s.error}` : t("pnl_datos_esc_fallo"), malo: true };
    const r = s.result;
    if (!r) return null;
    const n = numero(r.prescored, locale);
    return { texto: r.cost ? t("pnl_datos_esc_hecho_coste", { n, coste: dolares(r.cost.cost_usd, locale, 2) }) : t("pnl_datos_esc_hecho", { n }) };
  }
  if (id === "poda") {
    const s = await getPodaEstado();
    if (s.status === "error") return { texto: s.error ?? t("pnl_datos_poda_fallo"), malo: true };
    const llm = ((s.result ?? {}) as Record<string, { vaciadas?: number; sin_archivar?: number }>).llm_call ?? {};
    const sin = llm.sin_archivar ?? 0;
    return { texto: t("pnl_datos_poda_hecha", { n: numero(llm.vaciadas ?? 0, locale) }) + (sin ? ` ${t("pnl_datos_poda_retenidas", { n: numero(sin, locale) })}` : "") };
  }
  return null;
}

export default function PantallaDatos() {
  const t = useTranslations();
  const locale = useLocale();
  const [datos, setDatos] = useState<EstadoDatos | null | false>(null);
  const [global, setGlobal] = useState<UniversoGlobalOpciones | null>(null);
  const [informe, setInforme] = useState<ScanReport | null>(null);
  const [horario, setHorario] = useState<Horario | null>(null);
  const [proc, setProc] = useState<EstadoProcesos | null>(null);
  const [lanzando, setLanzando] = useState<ProcesoId | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [abierto, setAbierto] = useState<ProcesoId | null>(null);
  const previo = useRef<string | null>(null);

  const leerDatos = useCallback(() => {
    getEstadoDatos().then(setDatos).catch(() => setDatos(false));
    getUniversoGlobal().then(setGlobal).catch(() => setGlobal(null));
    getScanReport().then(r => setInforme(r.report)).catch(() => setInforme(null));
  }, []);
  const sondear = useCallback(async () => {
    try { setProc(await get<EstadoProcesos>("/admin/procesos/estado")); } catch { /* el próximo sondeo lo reintenta */ }
  }, []);

  useEffect(() => {
    leerDatos();
    sondear();
    get<Horario>("/admin/procesos/horario").then(setHorario).catch(() => setHorario(null));
  }, [leerDatos, sondear]);

  // Mientras algo corre se sondea; al acabar un proceso de fondo se lee cómo terminó.
  const ocupado = proc?.en_marcha != null || lanzando !== null;
  useEffect(() => {
    if (!ocupado) return;
    const timer = setInterval(sondear, 3000);
    return () => clearInterval(timer);
  }, [ocupado, sondear]);
  useEffect(() => {
    const id = proc?.en_marcha?.id ?? null;
    const acabado = previo.current;
    previo.current = id;
    if (!acabado || id === acabado) return;
    leerDatos();
    resultadoDe(acabado, t, locale).then(a => { if (a) setAviso(a); }).catch(() => {});
  }, [proc, leerDatos, t, locale]);

  const lanzar = useCallback((id: ProcesoId, accion: Accion) => {
    setLanzando(id);
    setAviso(null);
    accion()
      .then(texto => { if (texto) setAviso({ texto }); })
      .catch(e => {
        const largo = id === "fx" || id === "analitica";
        const texto = e instanceof ApiError && e.status === 409 ? t("pnl_datos_hay_otro")
          : largo && e instanceof ApiError && e.kind === "network" ? t("pnl_datos_segundo_plano")
          : e instanceof Error ? e.message : t("admin_generic_error");
        setAviso({ texto, malo: true });
      })
      .finally(() => { setLanzando(null); leerDatos(); sondear(); });
  }, [t, leerDatos, sondear]);

  const cuando = (iso: string | null | undefined) => (iso ? hace(iso, locale) : t("pnl_datos_nunca"));
  const fila = (id: ProcesoId): { ultima: string; dato: string } => {
    if (id === "escaneo") {   // no depende del estado de las fuentes: sale del informe del último escaneo
      return {
        ultima: cuando(informe?.at),
        dato: informe && !informe.error && informe.prescored != null ? t("pnl_datos_dato_escaneo", { n: numero(informe.prescored, locale) }) : "",
      };
    }
    if (!datos) return { ultima: "", dato: "" };
    switch (id) {
      case "foto": return { ultima: cuando(datos.universo.at), dato: t("pnl_datos_dato_foto", { n: numero(datos.universo.elegibles, locale) }) };
      case "global": return { ultima: cuando(global?.synced_at ?? proc?.ultima.global), dato: global ? t("pnl_datos_dato_global", { n: numero(global.total, locale) }) : "" };
      case "fund": {
        const a = datos.foto_nasdaq.at, b = datos.foto_global.at;
        return { ultima: cuando(a && b ? (a > b ? a : b) : a ?? b), dato: t("pnl_datos_dato_fund", { nasdaq: numero(datos.foto_nasdaq.n, locale), global: numero(datos.foto_global.n, locale) }) };
      }
      case "fx": return { ultima: cuando(datos.fx.at), dato: t("pnl_datos_dato_fx", { n: datos.fx.n }) };
      case "analitica": return { ultima: cuando(proc?.ultima.analitica), dato: "" };
      case "poda": return { ultima: proc?.ultima.poda ? cuando(proc.ultima.poda) : t("pnl_datos_sin_registro"), dato: "" };
      default: return { ultima: "", dato: "" };
    }
  };

  const enMarcha = proc?.en_marcha ?? (lanzando ? { id: lanzando, desde: null, progreso: null } : null);
  const prog = enMarcha?.progreso;
  const pct = prog && prog.total ? (prog.hechas / prog.total) * 100 : null;
  const ultimaAbierta = abierto ? fila(abierto) : { ultima: "", dato: "" };

  return (
    <div className="pnl-llega">
      {enMarcha && (
        <Grupo cabecera={t("pnl_datos_en_marcha")}>
          <li>
            <div className="pd-marcha" role="status">
              <span>
                <b>{t(`pnl_datos_p_${enMarcha.id}`)}</b>
                {prog && prog.total ? <small>{t("pnl_datos_avance", { hechas: numero(prog.hechas, locale), total: numero(prog.total, locale), unidad: prog.unidad ?? "" })}</small> : null}
              </span>
              {pct !== null ? <Progreso valor={pct} etiqueta={t(`pnl_datos_p_${enMarcha.id}`)} /> : <span className="pd-indet" aria-hidden="true"><i /></span>}
            </div>
          </li>
        </Grupo>
      )}
      {aviso && <p className={`pd-aviso${aviso.malo ? " malo" : ""}`} role={aviso.malo ? "alert" : "status"}>{aviso.texto}</p>}

      {datos === null ? <Esqueleto filas={6} etiqueta={t("admin_pnl_cargando")} /> : (
        <Grupo cabecera={t("pnl_datos_procesos")}
          pie={t(ocupado ? "pnl_datos_pie_ocupado" : "pnl_datos_pie_libre")}>
          {PROCESOS.map(id => {
            const f = fila(id);
            return (
              <Celda key={id} titulo={t(`pnl_datos_p_${id}`)} subtitulo={[f.ultima, f.dato].filter(Boolean).join(" · ") || undefined}
                valor={enMarcha?.id === id ? t("pnl_datos_marcha") : undefined} onClick={() => setAbierto(id)} />
            );
          })}
        </Grupo>
      )}
      {datos === false && <p className="pnl-pie-grupo" role="alert">{t("pnl_datos_sin_estado")}</p>}

      <Grupo cabecera={t("pnl_datos_de_pago")} pie={t("pnl_datos_de_pago_pie")}>
        <Celda titulo={t(`pnl_datos_p_${ESCANEO}`)} subtitulo={[fila(ESCANEO).ultima, fila(ESCANEO).dato].filter(Boolean).join(" · ") || undefined}
          valor={enMarcha?.id === ESCANEO ? t("pnl_datos_marcha") : undefined} onClick={() => setAbierto(ESCANEO)} />
      </Grupo>

      <Grupo cabecera={t("pnl_datos_herramientas")}>
        <Celda titulo={t("pnl_datos_esc_ver")} subtitulo={t("pnl_datos_esc_ver_sub")} href="/admin/datos/escaneo" />
        <Celda titulo={t("pnl_datos_explorar")} subtitulo={t("pnl_datos_explorar_sub")} href="/admin/datos/explorar" />
      </Grupo>

      <HojaProceso id={abierto} onCerrar={() => setAbierto(null)} horario={horario} ultima={ultimaAbierta.ultima} dato={ultimaAbierta.dato}
        ocupado={ocupado} global={global} lanzar={lanzar} />
    </div>
  );
}
