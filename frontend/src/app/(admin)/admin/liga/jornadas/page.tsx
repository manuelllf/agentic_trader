"use client";

// Control de la liguilla: temporadas, jornadas y sus procesos. Cada paso se ejecuta tras ver su
// vista previa; el estado sale del dominio (backend/app/liga/procesos/estado.py).

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { ApiError, get, post, probarResumenLiga } from "@/lib/api";
import { Pagina, Bloque, Boton, Chip, Interruptor, Lista, Fila, Barra, Estado as EstadoVista } from "../../_marco/ui";
import { fechaCorta, fechaHora, porcentajeConSigno } from "../../_marco/formato";
import { VistaPrevia } from "./VistaPrevia";



type Intento = { cuando: string; ok: boolean; objeto: string | null; detalle: unknown } | null;
type Jornada = {
  dias_bolsa?: { hechos: number; total: number } | null;
  id: number; numero: number; dia_inicio: string; dia_fin: string; cierre_inscripcion: string;
  estado: "programada" | "formada" | "cerrada"; foto_id: number | null; scan_run_id: number | null;
  plan_b: boolean | null; inscripciones: number; sp_rentabilidad: string | null;
  siguiente: "foto" | "formar" | "cerrar" | null; foto_auto: boolean | null;
};
type Temporada = { id: number; nombre: string; cuenta: boolean; estado: string; jornadas: Jornada[] };
type Estado = {
  diario_activo: boolean; temporadas: Temporada[]; ultimo_intento: Record<string, Intento>;
};
type Accion = { proceso: string; titulo: string; cuerpo: Record<string, unknown> };

const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Jornadas() {
  const t = useTranslations();
  const locale = useLocale();
  const mes = (j: Jornada) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(j.dia_inicio));
  const rango = (j: Jornada) => t("admin_rango", { desde: fechaCorta(j.dia_inicio, locale), hasta: fechaCorta(j.dia_fin, locale) });
  const paso = (id: string) => t(id === "foto" ? "admin_liga_step_photo" : id === "formar" ? "admin_liga_step_form" : "admin_liga_step_close");
  const nombreProceso = (id: string) => ({ temporadas: t("admin_liga_process_seasons"), foto: t("admin_liga_process_photo"), formar: t("admin_liga_process_form"), diario: t("admin_liga_process_daily"), cerrar: t("admin_liga_process_close") }[id] ?? id);
  const errorText = useCallback((e: unknown) => error(e, t("admin_generic_error")), [t]);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [fallo, setFallo] = useState("");
  const [accion, setAccion] = useState<Accion | null>(null);
  const [previa, setPrevia] = useState<unknown>(null);
  const [hecho, setHecho] = useState<unknown>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resumenOcupado, setResumenOcupado] = useState<"semanal" | "mensual" | null>(null);
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
    setAccion(a); setPrevia(null); setHecho(null); setFallo(""); setOcupado(true);
    setAceptarSinCierre(false);
    try {
      setPrevia(await post(`/liga/admin/procesos/${a.proceso}/vista-previa`, a.cuerpo, 90_000));
    } catch (e) { setFallo(errorText(e)); } finally { setOcupado(false); }
  };

  const ejecutar = async () => {
    if (!accion) return;
    setOcupado(true); setFallo("");
    try {
      const cuerpo = accion.proceso === "cerrar" && aceptarSinCierre
        ? { ...accion.cuerpo, aceptar_sin_cierre: true } : accion.cuerpo;
      setHecho(await post(`/liga/admin/procesos/${accion.proceso}/ejecutar`, cuerpo, 90_000));
      cargar();
    } catch (e) { setFallo(errorText(e)); } finally { setOcupado(false); }
  };

  const probarResumen = async (tipo: "semanal" | "mensual") => {
    if (resumenOcupado) return;
    setResumenOcupado(tipo); setResumenMensaje(""); setResumenError(false);
    try {
      const r = await probarResumenLiga(tipo);
      setResumenMensaje(t("admin_liga_resumen_probar_resultado", { enviados: r.enviados }));
    } catch {
      setResumenError(true);
      setResumenMensaje(t("admin_liga_resumen_probar_error"));
    } finally { setResumenOcupado(null); }
  };

  const interruptor = async () => {
    if (!estado) return;
    setOcupado(true);
    try {
      await post("/liga/admin/procesos/diario/interruptor", { activo: !estado.diario_activo });
      cargar();
    } catch (e) { setFallo(errorText(e)); } finally { setOcupado(false); }
  };

  const actual = estado?.temporadas.flatMap(s => s.jornadas).find(j => j.estado === "formada");
  const abrirJornada = (j: Jornada) => abrir({ proceso: j.siguiente!, titulo: `${paso(j.siguiente!)} ${j.numero}`, cuerpo: { jornada_id: j.id } });
  const detalle = (j: Jornada) => [rango(j),
    j.foto_id != null ? t("admin_liga_photo", { id: j.foto_id, mode: j.foto_auto === true ? t("admin_liga_photo_auto") : j.foto_auto === false ? t("admin_liga_photo_manual") : "" }) : null,
    j.scan_run_id != null ? t("admin_liga_scan", { id: j.scan_run_id, planB: j.plan_b ? t("admin_liga_plan_b") : "" }) : null,
    j.inscripciones ? t("admin_liga_playing", { count: j.inscripciones }) : null,
    j.sp_rentabilidad != null ? t("admin_liga_sp", { value: porcentajeConSigno(j.sp_rentabilidad, locale) }) : null,
  ].filter(Boolean).join(" · ");
  return <Pagina repetido titulo={t("admin_jornadas_titulo")}>
    {fallo && <EstadoVista tipo="error">{fallo}</EstadoVista>}
    {!estado ? !fallo && <EstadoVista tipo="cargando" /> : <>
      {actual && <Bloque titulo={t("admin_jornadas_actual")}>
        <Fila><span>{t("admin_jornadas_numero", { n: actual.numero })} · {mes(actual)}</span><Chip tono="bien">{t("admin_liga_season_status_in_game")}</Chip></Fila>
        <Barra valor={actual.dias_bolsa?.hechos ?? 0} maximo={actual.dias_bolsa?.total ?? 0} />
        <p className="adm-nota mt-2 mb-3">{actual.dias_bolsa && <>{t("admin_jornadas_dia", actual.dias_bolsa)} · </>}{t("admin_jornadas_estrategias", { n: actual.inscripciones })} · {rango(actual)}</p>
        {actual.siguiente && <Boton variante="pri" disabled={ocupado} onClick={() => void abrirJornada(actual)}>{paso(actual.siguiente)}…</Boton>}
      </Bloque>}
      {accion && <Bloque titulo={accion.titulo} className="adm-previa">
        {previa == null && <EstadoVista tipo="cargando" />}
        {previa != null && <>
          <VistaPrevia proceso={accion.proceso} datos={(hecho ?? previa) as Record<string, unknown>} hecho={hecho != null} />
          {hecho == null ? <>
            {faltanCierres.length > 0 && <label className="flex items-start gap-3 py-3"><input type="checkbox" checked={aceptarSinCierre} onChange={e => setAceptarSinCierre(e.target.checked)} /><span>{t("admin_liga_missing_close", { tickers: faltanCierres.join(", ") })}</span></label>}
            <div className="flex gap-2">
              {(previa as { listo?: boolean }).listo !== false && <Boton variante="pri" onClick={() => void ejecutar()} disabled={ocupado || (faltanCierres.length > 0 && !aceptarSinCierre)}>{t(ocupado ? "admin_liga_running" : "admin_liga_execute")}</Boton>}
              <Boton variante="texto" disabled={ocupado} onClick={() => setAccion(null)}>{t("admin_liga_cancel")}</Boton>
            </div>
          </> : <Boton variante="texto" onClick={() => setAccion(null)}>{t("admin_liga_close")}</Boton>}
        </>}
        {previa == null && !ocupado && <Boton variante="texto" onClick={() => setAccion(null)}>{t("admin_liga_cancel")}</Boton>}
      </Bloque>}
      <div className="adm-dos"><div className="flex flex-col gap-8">
        {estado.temporadas.length === 0 ? <Bloque titulo={t("admin_previa_temporadas")}>
          <p className="adm-nota">{t("admin_liga_no_seasons")}</p><Boton variante="pri" disabled={ocupado} onClick={() => void abrir({ proceso: "temporadas", titulo: t("admin_liga_process_title_seasons"), cuerpo: {} })}>{t("admin_jornadas_crear")}…</Boton>
        </Bloque> : estado.temporadas.map(s => <Bloque key={s.id} titulo={s.nombre} extra={<Chip>{t(s.cuenta ? "admin_liga_counts" : "admin_liga_does_not_count")}</Chip>}>
          <Lista>{s.jornadas.map(j => <Fila key={j.id}><div><span>{j.numero} · {mes(j).replace(/^./, c => c.toLocaleUpperCase(locale))}</span><p className="adm-nota">{detalle(j)}</p></div>
            <Chip tono={j.estado === "formada" ? "bien" : "neutro"}>{t(j.estado === "formada" ? "admin_liga_season_status_formed" : j.estado === "cerrada" ? "admin_liga_season_status_closed" : "admin_liga_season_status_programmed")}</Chip>
            {j.siguiente && j.id !== actual?.id && <Boton variante="sec" className="text-xs" disabled={ocupado} onClick={() => void abrirJornada(j)}>{paso(j.siguiente)}…</Boton>}
          </Fila>)}</Lista>
        </Bloque>)}
      </div><div className="flex flex-col gap-8">
        <Bloque titulo={t("admin_liga_daily_close")}>
          <Fila><span>{t("admin_jornadas_automatico")}</span><Interruptor etiqueta={t("admin_jornadas_automatico")} encendido={estado.diario_activo} alCambiar={() => void interruptor()} deshabilitado={ocupado} /></Fila>
          <p className="adm-nota">{t("admin_liga_daily_note")}</p>
          <Boton variante="sec" disabled={ocupado} onClick={() => void abrir({ proceso: "diario", titulo: t("admin_liga_process_title_daily"), cuerpo: {} })}>{t("admin_liga_run_now")}…</Boton>
          <div className="flex flex-wrap gap-2">{(["semanal", "mensual"] as const).map(tipo => <Boton variante="texto" key={tipo} disabled={resumenOcupado !== null} onClick={() => void probarResumen(tipo)}>{t(tipo === "semanal" ? "admin_liga_resumen_probar_semanal" : "admin_liga_resumen_probar_mensual")}</Boton>)}</div>
          <p className="adm-nota">{t("admin_jornadas_pruebas")}</p>
          {resumenMensaje && <p role={resumenError ? "alert" : "status"}>{resumenMensaje}</p>}
        </Bloque>
        <Bloque titulo={t("admin_liga_last_attempts")}><Lista>{Object.entries(estado.ultimo_intento).map(([p, i]) => <Fila key={p}><span>{nombreProceso(p)}</span>{i ? <><Chip tono={i.ok ? "bien" : "mal"}>{t(i.ok ? "admin_liga_ok" : "admin_liga_failed")}</Chip><span className="adm-nota">{fechaHora(i.cuando, locale)}</span></> : <span className="adm-nota">{t("admin_liga_never")}</span>}</Fila>)}</Lista></Bloque>
      </div></div>
    </>}
  </Pagina>;
}

export default function JornadasAdmin() { return <AuthGate><Jornadas /></AuthGate>; }
