"use client";

// Errores que la gente reporta desde la web (el código que vio coincide con el del registro del servidor)
// y reportes de contenido de la liga. Cada fila abre una hoja con el detalle y su acción.

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useConfirmar } from "@/components/Confirmar";
import { ApiError, get, post } from "@/lib/api";
import { Celda, Datos, Esqueleto, Grupo, Hoja, Segmentado, Vacio } from "../../_panel/ui";
import { Boton } from "../../_contenido/piezas";
import { hace, numero } from "../../_marco/formato";

type Aviso = {
  id: number; codigo: string | null; alias: string | null; pantalla: string; mensaje: string;
  nota: string | null; contexto: Record<string, unknown>; estado: "abierto" | "resuelto";
  creado: string;
};
type Reporte = {
  id: number; autor_id: string | null; tipo: "alias" | "estrategia" | "liga" | "pregunta";
  objeto_id: string; motivo: string; estado: string; creado: string; contenido: string | null;
};
type Lista<T> = { total: number; filas: T[] };
type Vista = "errores" | "reportes" | "resueltos";
type Elegido = { clase: "error"; item: Aviso } | { clase: "reporte"; item: Reporte };

const CUANTOS = 50;
const RUTA_ERRORES = (estado: "abierto" | "resuelto") => `/liga/admin/errores?estado=${estado}&cuantos=${CUANTOS}`;
const RUTA_REPORTES = `/liga/moderacion/reportes?cuantos=${CUANTOS}`;
const CORTE = 140;

/** Carga una lista y permite recargarla; descarta respuestas de una ruta anterior. */
function useLista<T>(ruta: string | null, mensaje: string) {
  const [datos, setDatos] = useState<Lista<T> | null>(null);
  const [fallo, setFallo] = useState("");
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    if (!ruta) return;
    let vigente = true;
    setFallo("");
    get<Lista<T>>(ruta).then(r => { if (vigente) setDatos(r); })
      .catch(e => { if (vigente) setFallo(e instanceof ApiError ? e.message : mensaje); });
    return () => { vigente = false; };
  }, [ruta, mensaje, vuelta]);
  const recargar = useCallback(() => setVuelta(v => v + 1), []);
  return { datos, fallo, recargar };
}

const corto = (texto: string) => (texto.length > CORTE ? `${texto.slice(0, CORTE).trimEnd()}…` : texto);

export default function Revisar() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const parametros = useSearchParams();
  const { confirmar, dialogo } = useConfirmar();
  const original = parametros.get("vista");
  const vista: Vista = original === "moderacion" || original === "reportes" ? "reportes" : original === "resueltos" ? "resueltos" : "errores";
  const generico = t("admin_generic_error");
  const errores = useLista<Aviso>(RUTA_ERRORES("abierto"), generico);
  const reportes = useLista<Reporte>(RUTA_REPORTES, generico);
  const resueltos = useLista<Aviso>(vista === "resueltos" ? RUTA_ERRORES("resuelto") : null, generico);
  const [elegido, setElegido] = useState<Elegido | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [fallo, setFallo] = useState("");

  useEffect(() => {
    if (original === "moderacion") router.replace("/admin/liga/revisar?vista=reportes", { scroll: false });
  }, [original, router]);

  const cerrar = () => { setElegido(null); setFallo(""); };
  const abrir = (e: Elegido) => { setFallo(""); setElegido(e); };
  const textoError = (e: unknown) => (e instanceof ApiError ? e.message : generico);

  const resolver = async (a: Aviso) => {
    setOcupado(true); setFallo("");
    try {
      await post(`/liga/admin/errores/${a.id}/resolver`);
      errores.recargar(); resueltos.recargar(); cerrar();
    } catch (e) { setFallo(textoError(e)); } finally { setOcupado(false); }
  };
  const tipos: Record<Reporte["tipo"], string> = { alias: t("admin_moderation_alias"), estrategia: t("admin_moderation_strategy"),
    liga: t("admin_moderation_league"), pregunta: t("admin_moderation_question") };
  const aConfirmar: Record<Reporte["tipo"], string> = { alias: t("admin_moderation_confirm_alias"), estrategia: t("admin_moderation_confirm_strategy"),
    liga: t("admin_moderation_confirm_league"), pregunta: t("admin_moderation_confirm_question") };
  const ocultar = async (r: Reporte) => {
    if (!(await confirmar({ titulo: t("admin_moderation_confirm_hide", { item: aConfirmar[r.tipo] }), aceptar: t("common_confirmar"), peligro: true }))) return;
    setOcupado(true); setFallo("");
    try {
      await post("/liga/moderacion/ocultar", { reporte_id: r.id });
      reportes.recargar(); cerrar();
    } catch (e) { setFallo(textoError(e)); } finally { setOcupado(false); }
  };

  const cuenta = (n?: number) => (n === undefined ? "" : ` (${numero(n, locale)})`);
  const activa = vista === "reportes" ? reportes : vista === "resueltos" ? resueltos : errores;
  const subtituloError = (a: Aviso) => [a.codigo, a.pantalla, a.alias ?? t("admin_errors_no_session"), hace(a.creado, locale)].filter(Boolean).join(" · ");
  const textoVacio = vista === "reportes" ? t("admin_moderation_empty") : vista === "resueltos" ? t("admin_errors_no_resolved") : t("admin_errors_no_open");

  const detalleError = (a: Aviso) => {
    const ruta = typeof a.contexto?.ruta === "string" ? a.contexto.ruta : null;
    const filas = [
      a.codigo ? { etiqueta: t("pnl_contenido_codigo"), valor: a.codigo } : null,
      { etiqueta: t("pnl_contenido_pantalla"), valor: a.pantalla },
      { etiqueta: t("pnl_contenido_usuario"), valor: a.alias ?? t("admin_errors_no_session") },
      ruta ? { etiqueta: t("pnl_contenido_ruta"), valor: ruta } : null,
      { etiqueta: t("pnl_contenido_cuando"), valor: hace(a.creado, locale) },
    ].filter((f): f is { etiqueta: string; valor: string } => f !== null);
    return <div className="pc-detalle">
      <h3>{a.mensaje}</h3>
      <Datos items={filas} />
      {a.nota && <blockquote>«{a.nota}»</blockquote>}
      {fallo && <p className="pc-aviso" role="alert">{fallo}</p>}
      {a.estado === "abierto" && <div className="pc-botones"><Boton disabled={ocupado} onClick={() => resolver(a)}>{t("pnl_contenido_marcar_resuelto")}</Boton></div>}
    </div>;
  };
  const detalleReporte = (r: Reporte) => <div className="pc-detalle">
    <h3>{r.contenido ?? t("admin_moderation_missing")}</h3>
    <Datos items={[
      { etiqueta: t("pnl_contenido_tipo"), valor: tipos[r.tipo] },
      { etiqueta: t("pnl_contenido_motivo"), valor: r.motivo },
      { etiqueta: t("pnl_contenido_cuando"), valor: hace(r.creado, locale) },
    ]} />
    {fallo && <p className="pc-aviso" role="alert">{fallo}</p>}
    <div className="pc-botones"><Boton tono="peligro" disabled={ocupado} onClick={() => ocultar(r)}>{t("pnl_contenido_ocultar")}</Boton></div>
  </div>;

  return <div className="pnl-llega">
    <Segmentado etiquetaGrupo={t("admin_revisar_titulo")} valor={vista}
      onChange={v => router.replace(`/admin/liga/revisar?vista=${v}`, { scroll: false })} opciones={[
        { valor: "errores", etiqueta: `${t("admin_revisar_errores")}${cuenta(errores.datos?.total)}` },
        { valor: "reportes", etiqueta: `${t("admin_revisar_reportes")}${cuenta(reportes.datos?.total)}` },
        { valor: "resueltos", etiqueta: t("admin_errors_resolved") },
      ]} />
    {activa.fallo && <p className="pc-aviso" role="alert">{activa.fallo}</p>}
    {!activa.datos && !activa.fallo && <Esqueleto filas={4} etiqueta={t("admin_pnl_cargando")} />}
    {activa.datos && (activa.datos.filas.length === 0
      ? <Vacio titulo={t("pnl_contenido_vacio_titulo")} texto={textoVacio} />
      : <Grupo pie={activa.datos.total > activa.datos.filas.length
        ? t(vista === "reportes" ? "admin_moderation_count" : "admin_errors_count",
          { total: numero(activa.datos.total, locale), shown: numero(activa.datos.filas.length, locale) })
        : undefined}>
        {vista === "reportes"
          ? (reportes.datos?.filas ?? []).map(r => <Celda key={r.id} titulo={corto(r.contenido ?? t("admin_moderation_missing"))}
            subtitulo={[tipos[r.tipo], r.motivo, hace(r.creado, locale)].join(" · ")} onClick={() => abrir({ clase: "reporte", item: r })} />)
          : ((vista === "resueltos" ? resueltos : errores).datos?.filas ?? []).map(a => <Celda key={a.id} titulo={corto(a.mensaje)}
            subtitulo={subtituloError(a)} onClick={() => abrir({ clase: "error", item: a })} />)}
      </Grupo>)}
    <Hoja abierta={elegido !== null} titulo={t(elegido?.clase === "reporte" ? "pnl_contenido_reporte" : "pnl_contenido_error")}
      accion={t("admin_pnl_listo")} onCerrar={cerrar}>
      {elegido?.clase === "error" && detalleError(elegido.item)}
      {elegido?.clase === "reporte" && detalleReporte(elegido.item)}
    </Hoja>
    {dialogo}
  </div>;
}
