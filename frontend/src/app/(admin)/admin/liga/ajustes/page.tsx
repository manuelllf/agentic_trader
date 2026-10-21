"use client";

// Ajustes: catálogo que trae su propio texto (grupo, título, ayuda) desde el backend: nada de
// claves JSON en crudo (feedback de Manuel: «no se entiende qué poner ni si va o no va»).

import { Bloque, Boton, Chip, Estado, Interruptor, Pagina } from "../../_marco/ui";
import { claveTituloAjuste } from "./etiquetas";
import { dolares } from "../../_marco/formato";
import { tokenSesion } from "@/lib/liga/supabase";
import { useConfirmar } from "@/components/Confirmar";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { ApiError, del, get, put } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Tipo = "interruptor" | "entero" | "dolares" | "multiplicador";
type Grupo = "Emergencia" | "IA" | "Créditos" | "Procesos" | "Premio" | "Liga" | "Panel";
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
const ORDEN_GRUPOS: Grupo[] = ["Emergencia", "IA", "Créditos", "Procesos", "Premio", "Liga", "Panel"];

const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Ajustes() {
  const t = useTranslations();
  const { confirmar, dialogo } = useConfirmar();
  const locale = useLocale();


  const grupoLabel = (g: Grupo) => t({ Emergencia: "admin_settings_group_emergency", IA: "admin_settings_group_ai", "Créditos": "admin_settings_group_credits", Premio: "admin_settings_group_prize", Liga: "admin_settings_group_league", Procesos: "admin_settings_group_processes", Panel: "admin_settings_group_panel" }[g]);
  const ajustesLabel = (a: Ajuste) => {
    const titulo = claveTituloAjuste(a.clave);
    const suffix = titulo?.replace(/^admin_setting_|_title$/g, "");
    if (titulo?.startsWith("admin_settings_panel_")) return { title: t(titulo), help: t(titulo.replace(/_titulo$/, "_ayuda")) };
    return suffix ? { title: t(titulo!), help: t(`admin_setting_${suffix}_help`) } : { title: a.titulo, help: a.ayuda };
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
               .map((a) => [a.clave, String(a.valor ?? a.efectivo ?? "")]),
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
        && !(await confirmar({ titulo: t("admin_settings_confirm_ai"), aceptar: t("common_confirmar") }))) {
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
    if (!(await confirmar({ titulo: t("admin_settings_reset_confirm", { title: ajustesLabel(a).title, value: valor(a, a.defecto) }), aceptar: t("common_confirmar") }))) return;
    setOcupada(a.clave); setErroresFila((e) => ({ ...e, [a.clave]: "" }));
    try {
      const fila = await del<Ajuste>(`/liga/admin/ajustes/${encodeURIComponent(a.clave)}`);
      setAjustes((prev) => prev!.map((x) => (x.clave === a.clave ? fila : x)));
      if (a.tipo !== "interruptor") setBorradores((b) => ({ ...b, [a.clave]: String(fila.valor ?? fila.efectivo ?? "") }));
      marcarGuardado(a.clave);
      if (a.grupo === "IA") get<EstadoIA>("/liga/admin/ia/estado").then(setEstadoIA).catch(() => {});
    } catch (e) {
      setErroresFila((er) => ({ ...er, [a.clave]: errorText(e) }));
    } finally {
      setOcupada(null);
    }
  };

  const [copiaOcupado, setCopiaOcupado] = useState(false);
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

  const razones = estadoIA?.finalidades.filter(f => !f.funciona && f.razon).map(f => f.razon!) ?? [];
  const compartidas = [...new Set(razones.filter(r => razones.filter(x => x === r).length > 1))];
  return <Pagina repetido titulo={t("admin_settings_title")}>
    {fallo && <Estado tipo="error">{fallo}</Estado>}
    {!ajustes || !estadoIA ? !fallo && <Estado tipo="cargando" /> : ORDEN_GRUPOS.map(grupo => {
      const filas = ajustes.filter(a => a.grupo === grupo && a.clave !== "ia.margen_objetivo");
      if (!filas.length) return null;
      return <Bloque key={grupo} titulo={grupoLabel(grupo)}>
        {grupo === "IA" && <>
          <p className="adm-nota">{t("admin_settings_spending", { gasto: dolares(estadoIA.gasto_mes_usd, locale), tope: estadoIA.tope_mensual_usd == null ? t("admin_settings_no_cap") : dolares(estadoIA.tope_mensual_usd, locale), formacion: dolares(estadoIA.gasto_formacion_usd, locale) })}</p>
          {compartidas.map(r => <Chip key={r} tono="aviso">{reasonLabel(r)}</Chip>)}
        </>}
        {filas.map(a => {
          const etiqueta = ajustesLabel(a);
          const estado = estadoIA.finalidades.find(f => f.finalidad === FINALIDAD_POR_CLAVE[a.clave]);
          const borrador = borradores[a.clave] ?? "";
          const guardado = a.valor ?? a.efectivo;
          const cambiado = borrador.trim() === "" ? guardado != null : guardado == null || Number(borrador.replace(",", ".")) !== Number(guardado);
          return <div key={a.clave} className="adm-ajuste">
            <div><p>{etiqueta.title}</p><p className="adm-nota">{etiqueta.help}</p></div>
            <div className="adm-ajuste-controles">
              {a.tipo === "interruptor" ? <Interruptor etiqueta={etiqueta.title} encendido={a.efectivo === true} deshabilitado={ocupada === a.clave} alCambiar={v => void guardarInterruptor(a, v)} /> : <>
                <input aria-label={etiqueta.title} type="number" step={a.tipo === "entero" ? "1" : "0.01"} min={a.minimo ?? undefined} max={a.maximo ?? undefined} value={borrador} onChange={e => setBorradores(b => ({ ...b, [a.clave]: e.target.value }))} className="adm-ajuste-numero" />
                {a.unidad && <span className="adm-nota">{a.unidad === "créditos" ? t("admin_settings_credits_unit") : a.unidad}</span>}
                {cambiado && <Boton variante="pri" disabled={ocupada === a.clave} onClick={() => void guardarNumero(a)}>{t("admin_settings_save")}</Boton>}
              </>}
              {guardadoOk === a.clave && <span className="adm-nota">{t("admin_settings_saved")}</span>}
              {a.valor != null && a.valor !== a.defecto && <Boton variante="texto" disabled={ocupada === a.clave} onClick={() => void restablecer(a)}>{t("admin_settings_reset_value", { value: valor(a, a.defecto) })}</Boton>}
              {estado && !estado.funciona && estado.razon && !compartidas.includes(estado.razon) && <Chip tono="aviso">{reasonLabel(estado.razon)}</Chip>}
              {erroresFila[a.clave] && <Estado tipo="error">{erroresFila[a.clave]}</Estado>}
            </div>
          </div>;
        })}
      </Bloque>;
    })}
    <Bloque titulo={t("admin_settings_tools")}><Boton variante="sec" disabled={copiaOcupado} onClick={() => void descargarCopia()}>{t(copiaOcupado ? "admin_liga_copy_loading" : "admin_liga_copy_download")}</Boton></Bloque>
    {dialogo}
  </Pagina>;
}

export default function AjustesAdmin() { return <AuthGate><Ajustes /></AuthGate>; }
