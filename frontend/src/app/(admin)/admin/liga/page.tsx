"use client";

// Control de la liguilla: temporadas, jornadas y sus procesos. Cada paso se ejecuta tras ver su
// vista previa; el estado sale del dominio (backend/app/liga/procesos/estado.py).

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { ApiError, get, post } from "@/lib/api";
import { tokenSesion } from "@/lib/liga/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Intento = { cuando: string; ok: boolean; objeto: string | null; detalle: unknown } | null;
type Jornada = {
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

function Resultado({ datos }: { datos: unknown }) {
  return (
    <pre className="mt-2 max-h-72 overflow-auto rounded-lg p-3 text-[11.5px] leading-relaxed"
         style={{ background: "#141413", color: "#c3c2b7" }}>
      {JSON.stringify(datos, null, 2)}
    </pre>
  );
}

function Liga() {
  const t = useTranslations();
  const locale = useLocale();
  const MES = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const DIA = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const CUANDO = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
  const paso = (id: string) => t(id === "foto" ? "admin_liga_step_photo" : id === "formar" ? "admin_liga_step_form" : "admin_liga_step_close");
  const estadoTemporada = (id: string) => ({ programada: t("admin_liga_season_status_programmed"), en_juego: t("admin_liga_season_status_in_game"), cerrada: t("admin_liga_season_status_closed") }[id] ?? id);
  const nombreProceso = (id: string) => ({ temporadas: t("admin_liga_process_seasons"), foto: t("admin_liga_process_photo"), formar: t("admin_liga_process_form"), diario: t("admin_liga_process_daily"), cerrar: t("admin_liga_process_close") }[id] ?? id);
  const errorText = useCallback((e: unknown) => error(e, t("admin_generic_error")), [t]);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [fallo, setFallo] = useState("");
  const [accion, setAccion] = useState<Accion | null>(null);
  const [previa, setPrevia] = useState<unknown>(null);
  const [hecho, setHecho] = useState<unknown>(null);
  const [ocupado, setOcupado] = useState(false);
  const [copiaOcupado, setCopiaOcupado] = useState(false);
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

  const descargarCopia = async () => {
    setCopiaOcupado(true); setFallo("");
    try {
      const sesion = await tokenSesion();
      const token = sesion?.aal === "aal2" ? sesion.token : null;
      const r = await fetch(`${API_URL}/liga/admin/copia`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!r.ok) throw new ApiError(t("admin_liga_copy_error", { status: r.status }), "http", r.status);
      const nombre = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1]
        ?? "liga_copia.tar.gz";
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setFallo(errorText(e)); } finally { setCopiaOcupado(false); }
  };

  const interruptor = async () => {
    if (!estado) return;
    setOcupado(true);
    try {
      await post("/liga/admin/procesos/diario/interruptor", { activo: !estado.diario_activo });
      cargar();
    } catch (e) { setFallo(errorText(e)); } finally { setOcupado(false); }
  };

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <Link href="/admin" className="text-[12.5px]" style={{ color: "#898781" }}>{t("admin_back_rooms")}</Link>
      <h1 className="mt-3 text-[19px] text-white"
          style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>Vennett</h1>

      <section className="mt-4 flex flex-wrap gap-2">
        {[
          { href: "/admin/liga/usuarios", texto: t("admin_liga_users") },
          { href: "/admin/liga/moderacion", texto: t("admin_liga_moderation") },
          { href: "/admin/liga/errores", texto: t("admin_liga_errors") },
          { href: "/admin/liga/ajustes", texto: t("admin_liga_settings") },
          { href: "/admin/liga/premio", texto: t("admin_liga_prize") },
          { href: "/admin/liga/auditoria", texto: t("admin_liga_audit") },
          { href: "/admin/liga/coste-ia", texto: t("admin_liga_ai_cost") },
        ].map((l) => (
          <Link key={l.href} href={l.href}
                className="min-h-[40px] rounded-lg px-3 py-2 font-bold text-white"
                style={{ background: "#2c2c2a" }}>
            {l.texto}
          </Link>
        ))}
        <button type="button" onClick={descargarCopia} disabled={copiaOcupado}
                className="min-h-[40px] rounded-lg px-3 py-2 font-bold text-white disabled:opacity-40"
                style={{ background: "#2c2c2a" }}>
          {copiaOcupado ? t("admin_liga_copy_loading") : t("admin_liga_copy_download")}
        </button>
      </section>

      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {!estado ? (
        !fallo && <p className="mt-6" style={{ color: "#898781" }}>{t("admin_loading")}</p>
      ) : (
        <>
          <section className="mt-5 rounded-xl border p-4" style={{ borderColor: "#303030" }}>
            <h2 className="font-bold text-white">{t("admin_liga_daily_close")}</h2>
            <p className="mt-1" style={{ color: "#898781" }}>
              {t("admin_liga_daily_note")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={interruptor} disabled={ocupado}
                      className="min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                      style={{ background: estado.diario_activo ? "#1f5f3a" : "#2c2c2a" }}>
                {estado.diario_activo ? t("admin_liga_auto_on") : t("admin_liga_auto_off")}
              </button>
              <button type="button" disabled={ocupado}
                      onClick={() => abrir({ proceso: "diario", titulo: t("admin_liga_process_title_daily"), cuerpo: {} })}
                      className="min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                      style={{ background: "#2c2c2a" }}>
                {t("admin_liga_run_now")}
              </button>
            </div>
          </section>

          {estado.temporadas.length === 0 ? (
            <section className="mt-4 rounded-xl border p-4" style={{ borderColor: "#303030" }}>
              <h2 className="font-bold text-white">{t("admin_liga_no_seasons")}</h2>
              <p className="mt-1" style={{ color: "#898781" }}>
                {t("admin_liga_create_seasons_note")}
              </p>
              <button type="button" disabled={ocupado}
                      onClick={() => abrir({ proceso: "temporadas", titulo: t("admin_liga_process_title_seasons"), cuerpo: {} })}
                      className="mt-3 min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                      style={{ background: "#3987e5" }}>
                {t("admin_liga_preview_create")}
              </button>
            </section>
          ) : estado.temporadas.map((season) => (
            <section key={season.id} className="mt-4">
              <h2 className="font-bold text-white">
                {season.nombre} <span className="font-normal" style={{ color: "#898781" }}>
                  · {season.cuenta ? t("admin_liga_counts") : t("admin_liga_does_not_count")} · {estadoTemporada(season.estado)}</span>
              </h2>
              <ul className="mt-2 border-t" style={{ borderColor: "#303030" }}>
                {season.jornadas.map((j) => (
                  <li key={j.id} className="border-b py-3" style={{ borderColor: "#303030" }}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-white">
                        {j.numero}. {MES.format(new Date(j.dia_inicio))}
                      </span>
                      <span style={{ color: j.estado === "cerrada" ? "#898781" : j.estado === "formada" ? "#5fb87a" : "#c3c2b7" }}>
                        {j.estado === "programada" ? t("admin_liga_season_status_programmed") : j.estado === "formada" ? t("admin_liga_season_status_formed") : t("admin_liga_season_status_closed")}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px]" style={{ color: "#898781" }}>
                      {DIA.format(new Date(j.dia_inicio))}–{DIA.format(new Date(j.dia_fin))}
                      {j.foto_id ? t("admin_liga_photo", { id: j.foto_id, mode: j.foto_auto === true ? t("admin_liga_photo_auto") : j.foto_auto === false ? t("admin_liga_photo_manual") : "" }) : ""}
                      {j.scan_run_id ? t("admin_liga_scan", { id: j.scan_run_id, planB: j.plan_b ? t("admin_liga_plan_b") : "" }) : ""}
                      {j.inscripciones ? t("admin_liga_playing", { count: new Intl.NumberFormat(locale).format(j.inscripciones) }) : ""}
                      {j.sp_rentabilidad != null ? t("admin_liga_sp", { value: j.sp_rentabilidad }) : ""}
                    </p>
                    {j.siguiente && (
                      <button type="button" disabled={ocupado}
                              onClick={() => abrir({
                                proceso: j.siguiente!, titulo: `${paso(j.siguiente!)} ${j.numero}`,
                                cuerpo: { jornada_id: j.id },
                              })}
                              className="mt-2 min-h-[40px] rounded-lg px-3 font-bold text-white disabled:opacity-40"
                              style={{ background: "#2c2c2a" }}>
                        {paso(j.siguiente)}…
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {accion && (
            <section className="mt-5 rounded-xl border p-4" style={{ borderColor: "#3987e5" }}>
              <h2 className="font-bold text-white">{accion.titulo}</h2>
              {ocupado && !previa && <p className="mt-2" style={{ color: "#898781" }}>{t("admin_liga_prepare_preview")}</p>}
              {previa != null && hecho == null && (
                <>
                  <p className="mt-2" style={{ color: "#898781" }}>{t("admin_liga_preview_unwritten")}</p>
                  <Resultado datos={previa} />
                  {faltanCierres.length > 0 && (
                    <label className="mt-3 flex min-h-[44px] items-start gap-3 rounded-lg p-3"
                           style={{ background: "#2a2216", color: "#e6c067" }}>
                      <input type="checkbox" checked={aceptarSinCierre}
                             onChange={(e) => setAceptarSinCierre(e.target.checked)}
                             className="mt-0.5 h-5 w-5 shrink-0" />
                      <span>
                        {t("admin_liga_missing_close", { tickers: faltanCierres.join(", ") })}
                      </span>
                    </label>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={ejecutar}
                            disabled={ocupado || (faltanCierres.length > 0 && !aceptarSinCierre)}
                            className="min-h-[44px] flex-1 rounded-lg px-4 font-bold text-white disabled:opacity-40"
                            style={{ background: "#3987e5" }}>
                      {ocupado ? t("admin_liga_running") : t("admin_liga_execute")}
                    </button>
                    <button type="button" onClick={() => setAccion(null)} disabled={ocupado}
                            className="min-h-[44px] rounded-lg px-4 disabled:opacity-40"
                            style={{ background: "#2c2c2a", color: "#c3c2b7" }}>
                      {t("admin_liga_cancel")}
                    </button>
                  </div>
                </>
              )}
              {hecho != null && (
                <>
                  <p className="mt-2 text-white">{t("admin_liga_done")}</p>
                  <Resultado datos={hecho} />
                  <button type="button" onClick={() => setAccion(null)}
                          className="mt-3 min-h-[44px] rounded-lg px-4"
                          style={{ background: "#2c2c2a", color: "#c3c2b7" }}>
                    {t("admin_liga_close")}
                  </button>
                </>
              )}
            </section>
          )}

          <section className="mt-6">
            <h2 className="font-bold text-white">{t("admin_liga_last_attempts")}</h2>
            <ul className="mt-2">
              {Object.entries(estado.ultimo_intento).map(([p, i]) => (
                <li key={p} className="flex justify-between gap-2 py-1">
                  <span>{nombreProceso(p)}</span>
                  <span style={{ color: !i ? "#898781" : i.ok ? "#5fb87a" : "#e66767" }}>
                    {!i ? t("admin_liga_never") : t("admin_liga_last_attempt_result", { result: i.ok ? t("admin_liga_ok") : t("admin_liga_failed"), date: CUANDO.format(new Date(i.cuando)) })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

export default function LigaAdmin() {
  return (
    <AuthGate>
      <Liga />
    </AuthGate>
  );
}
