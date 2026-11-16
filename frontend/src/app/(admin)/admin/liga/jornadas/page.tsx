"use client";

// Control de la liguilla: temporadas, jornadas y sus procesos. Cada paso se ejecuta tras ver su
// vista previa; el estado sale del dominio (backend/app/liga/procesos/estado.py).

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useConfirmar } from "@/components/Confirmar";
import { ApiError, get, post, probarResumenLiga } from "@/lib/api";
import { fechaCorta, fechaHora, porcentajeConSigno } from "../../_marco/formato";
import { Celda, CeldaInterruptor, Esqueleto, Grupo, Hoja, Progreso, Vacio } from "../../_panel/ui";
import { nombreProceso } from "../resumen/logica";
import { VistaPrevia } from "./VistaPrevia";
import "../pl.css";

type Intento = { cuando: string; ok: boolean; objeto: string | null; detalle: unknown } | null;
type Jornada = {
  dias_bolsa?: { hechos: number; total: number } | null;
  id: number; numero: number; dia_inicio: string; dia_fin: string; cierre_inscripcion: string;
  estado: "programada" | "formada" | "cerrada"; foto_id: number | null; scan_run_id: number | null;
  plan_b: boolean | null; inscripciones: number; sp_rentabilidad: string | null;
  siguiente: "foto" | "formar" | "cerrar" | null; foto_auto: boolean | null;
};
type Temporada = { id: number; nombre: string; cuenta: boolean; estado: string; n_jornadas?: number; jornadas: Jornada[] };
type Estado = {
  diario_activo: boolean; temporadas: Temporada[]; ultimo_intento: Record<string, Intento>;
};
type Accion = { proceso: string; titulo: string; cuerpo: Record<string, unknown> };

const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export default function JornadasAdmin() {
  const t = useTranslations();
  const locale = useLocale();
  const { confirmar, dialogo } = useConfirmar();
  const mes = (j: Jornada) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(j.dia_inicio));
  const rango = (j: Jornada) => t("admin_rango", { desde: fechaCorta(j.dia_inicio, locale), hasta: fechaCorta(j.dia_fin, locale) });
  const paso = (id: string) => t(id === "foto" ? "admin_liga_step_photo" : id === "formar" ? "admin_liga_step_form" : "admin_liga_step_close");
  const nombre = (id: string) => {
    const clave = nombreProceso(id);
    const texto = clave === id ? id : t(clave);
    return texto.replace(/^./, c => c.toLocaleUpperCase(locale));
  };
  const errorText = useCallback((e: unknown) => error(e, t("admin_generic_error")), [t]);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [fallo, setFallo] = useState("");
  const [accion, setAccion] = useState<Accion | null>(null);
  const [previa, setPrevia] = useState<unknown>(null);
  const [hecho, setHecho] = useState<unknown>(null);
  const [falloHoja, setFalloHoja] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [resumenOcupado, setResumenOcupado] = useState(false);
  const [resumenMensaje, setResumenMensaje] = useState("");
  const [resumenError, setResumenError] = useState(false);
  const [aceptarSinCierre, setAceptarSinCierre] = useState(false);
  // Al cerrar: valores en cartera a los que les falta el cierre del último día (viene en la vista previa).
  const faltanCierres = accion?.proceso === "cerrar"
    ? ((previa as { faltan_cierres?: string[] } | null)?.faltan_cierres ?? []) : [];

  const cargar = useCallback(() => {
    get<Estado>("/liga/admin/procesos/estado").then(setEstado).catch((e) => setFallo(errorText(e)));
  }, [errorText]);
  useEffect(cargar, [cargar]);

  const abrir = async (a: Accion) => {
    setAccion(a); setPrevia(null); setHecho(null); setFalloHoja(""); setOcupado(true);
    setAceptarSinCierre(false);
    try {
      setPrevia(await post(`/liga/admin/procesos/${a.proceso}/vista-previa`, a.cuerpo, 90_000));
    } catch (e) { setFalloHoja(errorText(e)); } finally { setOcupado(false); }
  };

  const ejecutar = async () => {
    if (!accion) return;
    setOcupado(true); setFalloHoja("");
    try {
      const cuerpo = accion.proceso === "cerrar" && aceptarSinCierre
        ? { ...accion.cuerpo, aceptar_sin_cierre: true } : accion.cuerpo;
      setHecho(await post(`/liga/admin/procesos/${accion.proceso}/ejecutar`, cuerpo, 90_000));
      cargar();
    } catch (e) { setFalloHoja(errorText(e)); } finally { setOcupado(false); }
  };

  const probarResumen = async () => {
    if (resumenOcupado) return;
    if (!(await confirmar({ titulo: t("pnl_liga_resumen_confirmar"), texto: t("admin_jornadas_pruebas"), aceptar: t("pnl_liga_enviar") }))) return;
    setResumenOcupado(true); setResumenMensaje(""); setResumenError(false);
    try {
      const r = await probarResumenLiga("mensual");
      setResumenMensaje(t("admin_liga_resumen_probar_resultado", { enviados: r.enviados }));
    } catch {
      setResumenError(true);
      setResumenMensaje(t("admin_liga_resumen_probar_error"));
    } finally { setResumenOcupado(false); }
  };

  const interruptor = async () => {
    if (!estado) return;
    setOcupado(true);
    try {
      await post("/liga/admin/procesos/diario/interruptor", { activo: !estado.diario_activo });
      cargar();
    } catch (e) { setFallo(errorText(e)); } finally { setOcupado(false); }
  };

  const cerrarHoja = () => setAccion(null);
  const todas = estado?.temporadas.flatMap(s => s.jornadas) ?? [];
  const actual = todas.find(j => j.estado === "formada");
  const temporadaActual = estado?.temporadas.find(s => s.jornadas.some(j => j.id === actual?.id));
  // Pasos pendientes: el de la jornada en curso y el de la primera que aún falta por preparar.
  const pendientes = [actual, todas.find(j => j.siguiente && j.id !== actual?.id)].filter((j): j is Jornada => Boolean(j?.siguiente));
  const abrirJornada = (j: Jornada) => void abrir({ proceso: j.siguiente!, titulo: `${paso(j.siguiente!)} ${j.numero}`, cuerpo: { jornada_id: j.id } });
  const detalle = (j: Jornada) => [rango(j),
    j.foto_id != null ? t("admin_liga_photo", { id: j.foto_id, mode: j.foto_auto === true ? t("admin_liga_photo_auto") : j.foto_auto === false ? t("admin_liga_photo_manual") : "" }) : null,
    j.scan_run_id != null ? t("admin_liga_scan", { id: j.scan_run_id, planB: j.plan_b ? t("admin_liga_plan_b") : "" }) : null,
    j.inscripciones ? t("admin_liga_playing", { count: j.inscripciones }) : null,
    j.sp_rentabilidad != null ? t("admin_liga_sp", { value: porcentajeConSigno(j.sp_rentabilidad, locale) }) : null,
  ].filter(Boolean).join(" · ");
  const hojaLista = (previa as { listo?: boolean } | null)?.listo !== false;

  return (
    <div className="pnl-llega">
      {fallo && <p className="pnl-pie-grupo" role="alert">{fallo}</p>}
      {!estado && !fallo && <Esqueleto filas={4} etiqueta={t("admin_pnl_cargando")} />}
      {estado && (
        <>
          {actual && (
            <div className="pl-cifra">
              <small>{temporadaActual?.nombre}</small>
              <b>{temporadaActual?.n_jornadas
                ? t("pnl_liga_jornada_de", { n: actual.numero, total: temporadaActual.n_jornadas })
                : t("admin_jornadas_numero", { n: actual.numero })} · {mes(actual)}</b>
              <p>{t("admin_liga_season_status_in_game")} · {actual.dias_bolsa && <>{t("admin_jornadas_dia", actual.dias_bolsa)} · </>}{t("admin_jornadas_estrategias", { n: actual.inscripciones })} · {rango(actual)}</p>
              {actual.dias_bolsa && <Progreso valor={actual.dias_bolsa.total ? (actual.dias_bolsa.hechos / actual.dias_bolsa.total) * 100 : 0} etiqueta={t("admin_jornadas_dia", actual.dias_bolsa)} />}
            </div>
          )}

          {pendientes.length > 0 && (
            <div className="pl-acciones">
              <button type="button" className="pl-boton" onClick={() => abrirJornada(pendientes[0])}>{t("pnl_liga_vista_previa")}</button>
              <button type="button" className="pl-boton pri" onClick={() => abrirJornada(pendientes[0])}>{t("pnl_liga_formar_ahora")}</button>
            </div>
          )}

          {estado.temporadas.length === 0 && (
            <>
              <Vacio titulo={t("admin_liga_no_seasons")} />
              <Grupo>
                <Celda titulo={t("admin_jornadas_crear")} tono="accion" deshabilitada={ocupado}
                  onClick={() => void abrir({ proceso: "temporadas", titulo: t("admin_liga_process_title_seasons"), cuerpo: {} })} />
              </Grupo>
            </>
          )}

          {pendientes.length > 0 && (
            <Grupo cabecera={t("pnl_liga_siguiente")} pie={t("pnl_liga_vista_previa_pie")}>
              {pendientes.map(j => (
                <Celda key={j.id} titulo={`${paso(j.siguiente!)} ${j.numero}`} subtitulo={rango(j)} valor={t("pnl_liga_vista_previa")}
                  deshabilitada={ocupado} onClick={() => abrirJornada(j)} />
              ))}
            </Grupo>
          )}

          {estado.temporadas.map(s => (
            <Grupo key={s.id} cabecera={`${s.nombre} · ${t(s.cuenta ? "admin_liga_counts" : "admin_liga_does_not_count")}`}
              pie={s.jornadas.some(j => j.siguiente) ? t("pnl_liga_toca_jornada") : undefined}>
              {s.jornadas.map(j => (
                <Celda key={j.id} titulo={`${j.numero} · ${mes(j).replace(/^./, c => c.toLocaleUpperCase(locale))}`} subtitulo={detalle(j)}
                  valor={t(j.estado === "formada" ? "admin_liga_season_status_formed" : j.estado === "cerrada" ? "admin_liga_season_status_closed" : "admin_liga_season_status_programmed")}
                  deshabilitada={ocupado && Boolean(j.siguiente)} onClick={j.siguiente ? () => abrirJornada(j) : undefined} />
              ))}
            </Grupo>
          ))}

          <Grupo cabecera={t("admin_liga_daily_close")} pie={resumenMensaje || t("admin_jornadas_pruebas")}>
            <CeldaInterruptor titulo={t("admin_jornadas_automatico")} subtitulo={t("admin_liga_daily_note")} activo={estado.diario_activo}
              onCambio={() => void interruptor()} deshabilitado={ocupado} />
            <Celda titulo={t("admin_liga_run_now")} tono="accion" deshabilitada={ocupado}
              onClick={() => void abrir({ proceso: "diario", titulo: t("admin_liga_process_title_daily"), cuerpo: {} })} />
            <Celda titulo={t("admin_liga_resumen_probar_mensual")} tono="accion" deshabilitada={resumenOcupado} onClick={() => void probarResumen()} />
          </Grupo>
          {resumenError && <p className="pnl-solo-lector" role="alert">{resumenMensaje}</p>}

          <Grupo cabecera={t("pnl_liga_procesos")}>
            {Object.entries(estado.ultimo_intento).map(([p, i]) => (
              <Celda key={p} titulo={nombre(p)} subtitulo={i ? fechaHora(i.cuando, locale) : undefined}
                valor={i ? t(i.ok ? "admin_liga_ok" : "admin_liga_failed") : t("admin_liga_never")} />
            ))}
          </Grupo>
        </>
      )}

      <Hoja abierta={accion !== null} titulo={accion?.titulo ?? ""} cancelar={hecho == null ? t("admin_liga_cancel") : undefined}
        accion={hecho != null ? t("admin_pnl_listo") : t(ocupado && previa != null ? "admin_liga_running" : "admin_liga_execute")}
        accionDesactivada={hecho == null && (previa == null || ocupado || !hojaLista || (faltanCierres.length > 0 && !aceptarSinCierre))}
        onAccion={hecho != null ? cerrarHoja : () => void ejecutar()} onCerrar={cerrarHoja}>
        <div className="pl-hoja">
          {accion && previa == null && !falloHoja && <Esqueleto filas={4} etiqueta={t("admin_pnl_cargando")} />}
          {falloHoja && <p className="pnl-pie-grupo" role="alert">{falloHoja}</p>}
          {accion && previa != null && (
            <>
              <VistaPrevia proceso={accion.proceso} datos={(hecho ?? previa) as Record<string, unknown>} hecho={hecho != null} />
              {hecho == null && faltanCierres.length > 0 && (
                <Grupo pie={t("admin_liga_missing_close", { tickers: faltanCierres.join(", ") })}>
                  <CeldaInterruptor titulo={t("admin_previa_sin_cierre")} activo={aceptarSinCierre} onCambio={setAceptarSinCierre} />
                </Grupo>
              )}
            </>
          )}
        </div>
      </Hoja>
      {dialogo}
    </div>
  );
}
