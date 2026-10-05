"use client";

// Ajustes: catálogo que trae su propio texto (grupo, título, ayuda) desde el backend — nada de
// claves JSON en crudo (feedback de Manuel: «no se entiende qué poner ni si va o no va»).

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { ApiError, del, get, put } from "@/lib/api";

type Tipo = "interruptor" | "entero" | "dolares" | "multiplicador";
type Grupo = "Emergencia" | "IA" | "Créditos";
type Valor = boolean | number | null;

type Ajuste = {
  clave: string; grupo: Grupo; titulo: string; ayuda: string; tipo: Tipo; unidad: string | null;
  minimo: string | null; maximo: string | null; defecto: Valor; valor: Valor; efectivo: Valor;
  actualizado: string | null; actualizado_por: string | null;
};

type Finalidad = "conversor" | "pregunta" | "lectura" | "formacion";
type EstadoIA = {
  enable_llm: boolean; deepseek_key_presente: boolean; typesafe_key_presente: boolean;
  gasto_mes_usd: string; tope_mensual_usd: string | null;
  gasto_formacion_usd: string; tope_formacion_usd: string | null;
  finalidades: { finalidad: Finalidad; funciona: boolean; razon: string | null }[];
};

// Solo los interruptores de IA llevan finalidad (para el chip «Funciona»/razón de /ia/estado).
const FINALIDAD_POR_CLAVE: Record<string, Finalidad> = {
  "ia.conversor.activo": "conversor", "ia.pregunta.activo": "pregunta",
  "ia.lectura.activo": "lectura", "ia.formacion.activo": "formacion",
};
const ORDEN_GRUPOS: Grupo[] = ["Emergencia", "IA", "Créditos"];

const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Ajustes() {
  const t = useTranslations();
  const locale = useLocale();
  const fecha = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const dollars = (v: string | number) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
  const grupoLabel = (g: Grupo) => t(g === "Emergencia" ? "admin_settings_group_emergency" : g === "IA" ? "admin_settings_group_ai" : "admin_settings_group_credits");
  const ajustesLabel = (a: Ajuste) => {
    const slug: Record<string, string> = { "liga.registro.abierto": "registration", "liga.visible": "league_public", "ia.conversor.activo": "ai_converter", "ia.pregunta.activo": "ai_question", "ia.lectura.activo": "ai_reading", "ia.tope_mensual_usd": "ai_cap", "ia.formacion.activo": "ai_formation", "ia.tope_formacion_usd": "ai_formation_cap", "procesos.formar.limite_preguntas_s": "form_question_limit", "ia.margen_objetivo": "ai_margin", "creditos.bienvenida": "welcome_credits", "procesos.foto.auto": "auto_photo", "procesos.formar.auto": "auto_form" };
    const suffix = slug[a.clave];
    return suffix ? { title: t(`admin_setting_${suffix}_title`), help: t(`admin_setting_${suffix}_help`) } : { title: a.titulo, help: a.ayuda };
  };
  const valor = (a: Ajuste, v: Valor) => {
    if (v == null) return t("admin_settings_unspecified");
    if (a.tipo === "interruptor") return v ? t("admin_settings_on") : t("admin_settings_off");
    const unit = a.unidad === "créditos" ? ` ${t("admin_settings_credits_unit")}` : a.unidad ? ` ${a.unidad}` : "";
    return `${new Intl.NumberFormat(locale).format(Number(v))}${unit}`;
  };
  const reasonLabel = (reason: string) => {
    const keys: Record<string, string> = { "Falta ENABLE_LLM en Railway": "admin_settings_reason_llm_disabled", "Sin clave de Jev": "admin_settings_reason_no_jev_key", "Sin clave de DeepSeek": "admin_settings_reason_no_deepseek_key", "Apagado aquí": "admin_settings_reason_disabled_here", "Tope mensual mal configurado": "admin_settings_reason_bad_cap", "Tope del mes alcanzado": "admin_settings_reason_cap_reached" };
    return keys[reason] ? t(keys[reason]) : reason;
  };
  const errorText = useCallback((e: unknown) => error(e, t("admin_generic_error")), [t]);
  const [ajustes, setAjustes] = useState<Ajuste[] | null>(null);
  const [estadoIA, setEstadoIA] = useState<EstadoIA | null>(null);
  const [fallo, setFallo] = useState("");
  const [erroresFila, setErroresFila] = useState<Record<string, string>>({});
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [guardadoOk, setGuardadoOk] = useState<string | null>(null);
  const [borradores, setBorradores] = useState<Record<string, string>>({});

  const cargar = useCallback(() => {
    setFallo("");
    Promise.all([get<Ajuste[]>("/liga/admin/ajustes"), get<EstadoIA>("/liga/admin/ia/estado")])
      .then(([lista, estado]) => {
        setAjustes(lista);
        setEstadoIA(estado);
        setBorradores(Object.fromEntries(
          lista.filter((a) => a.tipo !== "interruptor")
               .map((a) => [a.clave, a.valor == null ? "" : String(a.valor)]),
        ));
      })
      .catch((e) => setFallo(errorText(e)));
  }, [errorText]);
  useEffect(cargar, [cargar]);

  const marcarGuardado = (clave: string) => {
    setGuardadoOk(clave);
    setTimeout(() => setGuardadoOk((c) => (c === clave ? null : c)), 2000);
  };

  const guardarInterruptor = async (a: Ajuste, nuevo: boolean) => {
    if (a.grupo === "IA" && nuevo
        && !window.confirm(t("admin_settings_confirm_ai"))) {
      return;
    }
    setOcupada(a.clave); setErroresFila((e) => ({ ...e, [a.clave]: "" }));
    try {
      const fila = await put<Ajuste>(`/liga/admin/ajustes/${encodeURIComponent(a.clave)}`,
                                     { valor: nuevo });
      setAjustes((prev) => prev!.map((x) => (x.clave === a.clave ? fila : x)));
      marcarGuardado(a.clave);
      // El interruptor pudo mover si una finalidad de IA funciona ahora; refresca su estado.
      get<EstadoIA>("/liga/admin/ia/estado").then(setEstadoIA).catch(() => {});
    } catch (e) {
      setErroresFila((er) => ({ ...er, [a.clave]: errorText(e) }));
    } finally {
      setOcupada(null);
    }
  };

  const guardarNumero = async (a: Ajuste) => {
    const texto = borradores[a.clave] ?? "";
    const numero = Number(texto.replace(",", "."));
    if (texto.trim() === "" || Number.isNaN(numero)) {
      setErroresFila((e) => ({ ...e, [a.clave]: t("admin_settings_number_error") }));
      return;
    }
    setOcupada(a.clave); setErroresFila((e) => ({ ...e, [a.clave]: "" }));
    try {
      const fila = await put<Ajuste>(`/liga/admin/ajustes/${encodeURIComponent(a.clave)}`,
                                     { valor: numero });
      setAjustes((prev) => prev!.map((x) => (x.clave === a.clave ? fila : x)));
      setBorradores((b) => ({ ...b, [a.clave]: fila.valor == null ? "" : String(fila.valor) }));
      marcarGuardado(a.clave);
    } catch (e) {
      setErroresFila((er) => ({ ...er, [a.clave]: errorText(e) }));
    } finally {
      setOcupada(null);
    }
  };

  const restablecer = async (a: Ajuste) => {
    if (!window.confirm(t("admin_settings_reset_confirm", { title: ajustesLabel(a).title, value: valor(a, a.defecto) }))) return;
    setOcupada(a.clave); setErroresFila((e) => ({ ...e, [a.clave]: "" }));
    try {
      const fila = await del<Ajuste>(`/liga/admin/ajustes/${encodeURIComponent(a.clave)}`);
      setAjustes((prev) => prev!.map((x) => (x.clave === a.clave ? fila : x)));
      if (a.tipo !== "interruptor") setBorradores((b) => ({ ...b, [a.clave]: "" }));
      marcarGuardado(a.clave);
      if (a.grupo === "IA") get<EstadoIA>("/liga/admin/ia/estado").then(setEstadoIA).catch(() => {});
    } catch (e) {
      setErroresFila((er) => ({ ...er, [a.clave]: errorText(e) }));
    } finally {
      setOcupada(null);
    }
  };

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <Link href="/admin/liga" className="text-[12.5px]" style={{ color: "#898781" }}>{t("admin_settings_back")}</Link>
      <h1 className="mt-3 text-[19px] text-white"
          style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>{t("admin_settings_title")}</h1>

      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {!ajustes || !estadoIA ? (
        !fallo && <p className="mt-6" style={{ color: "#898781" }}>{t("admin_loading")}</p>
      ) : (
        ORDEN_GRUPOS.map((grupo) => {
          const filas = ajustes.filter((a) => a.grupo === grupo);
          if (filas.length === 0) return null;
          return (
            <section key={grupo} className="mt-6">
              <h2 className="text-[15px] font-bold text-white">{grupoLabel(grupo)}</h2>
              {grupo === "IA" && (
                <p className="mt-1" style={{ color: "#898781" }}>
                  {t("admin_settings_spending_lead")} {dollars(estadoIA.gasto_mes_usd)}
                  {estadoIA.tope_mensual_usd != null ? ` de ${dollars(estadoIA.tope_mensual_usd)}` : t("admin_settings_spending_no_cap")}
                  {" "}{t("admin_settings_spending_tail")}
                  <br />
                  {t("admin_settings_spending_formation_lead")} {dollars(estadoIA.gasto_formacion_usd)}
                  {estadoIA.tope_formacion_usd != null ? ` de ${dollars(estadoIA.tope_formacion_usd)}` : t("admin_settings_spending_no_cap")}
                  {" "}{t("admin_settings_spending_tail")}
                </p>
              )}
              <ul className="mt-2 border-t" style={{ borderColor: "#303030" }}>
                {filas.map((a) => {
                  const finalidad = FINALIDAD_POR_CLAVE[a.clave];
                  const estado = finalidad
                    ? estadoIA.finalidades.find((f) => f.finalidad === finalidad)
                    : undefined;
                  const errorFila = erroresFila[a.clave];
                  const encendido = a.efectivo === true;
                  return (
                    <li key={a.clave} className="border-b py-3" style={{ borderColor: "#303030" }}>
                      <p className="text-white">{ajustesLabel(a).title}</p>
                      <p className="mt-0.5 text-[11.5px]" style={{ color: "#898781" }}>{ajustesLabel(a).help}</p>

                      {a.tipo === "interruptor" ? (
                        <div className="mt-2 flex items-center gap-3">
                          <button type="button" role="switch" aria-checked={encendido}
                                  aria-label={ajustesLabel(a).title} disabled={ocupada === a.clave}
                                  onClick={() => guardarInterruptor(a, !encendido)}
                                  className="relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors disabled:opacity-50"
                                  style={{ background: encendido ? "#2f9e5b" : "#3a3a38" }}>
                            <span className="absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-white transition-transform"
                                  style={{ transform: encendido ? "translateX(20px)" : "translateX(0)" }} />
                          </button>
                          <span className="font-bold" style={{ color: encendido ? "#6fd396" : "#898781" }}>
                            {encendido ? t("admin_settings_on") : t("admin_settings_off")}
                          </span>
                          {guardadoOk === a.clave && <span style={{ color: "#6fd396" }}>{t("admin_settings_saved")}</span>}
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center gap-2">
                          <input type="number" step="0.01"
                                 min={a.minimo ?? undefined} max={a.maximo ?? undefined}
                                 value={borradores[a.clave] ?? ""}
                                 placeholder={a.defecto != null ? String(a.defecto) : t("admin_settings_unspecified")}
                                 onChange={(e) => setBorradores({ ...borradores, [a.clave]: e.target.value })}
                                 className="min-h-[44px] w-28 rounded-lg border px-3 text-white"
                                 style={{ background: "#141413", borderColor: "#303030" }} />
                          {a.unidad && <span style={{ color: "#898781" }}>{a.unidad}</span>}
                          <button type="button" disabled={ocupada === a.clave
                                    || (borradores[a.clave] ?? "") === (a.valor == null ? "" : String(a.valor))}
                                  onClick={() => guardarNumero(a)}
                                  className="min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                                  style={{ background: "#3987e5" }}>
                            {t("admin_settings_save")}
                          </button>
                          {guardadoOk === a.clave && <span style={{ color: "#6fd396" }}>{t("admin_settings_saved")}</span>}
                        </div>
                      )}

                      {estado && (
                        <p className="mt-1.5 inline-block rounded px-1.5 py-0.5 text-[11.5px]"
                           style={estado.funciona
                             ? { background: "#1f5f3a", color: "#9be0b3" }
                             : { background: "#2a1616", color: "#e6a667" }}>
                          {estado.funciona ? t("admin_settings_works") : t("admin_settings_not_working", { reason: reasonLabel(estado.razon ?? "") })}
                        </p>
                      )}

                      {errorFila && <p className="mt-1.5" style={{ color: "#e66767" }}>{errorFila}</p>}

                      <p className="mt-1.5 text-[11.5px]" style={{ color: "#67665f" }}>
                        {a.valor == null
                          ? t("admin_settings_default", { value: valor(a, a.defecto) })
                          : t("admin_settings_updated", { date: a.actualizado ? fecha.format(new Date(a.actualizado)) : "" })}
                        {a.valor != null && (
                          <button type="button" onClick={() => restablecer(a)} disabled={ocupada === a.clave}
                                  className="ml-2 underline disabled:opacity-40" style={{ color: "#67665f" }}>
                            {t("admin_settings_reset")}
                          </button>
                        )}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </main>
  );
}

export default function AjustesAdmin() {
  return (
    <AuthGate>
      <Ajustes />
    </AuthGate>
  );
}
