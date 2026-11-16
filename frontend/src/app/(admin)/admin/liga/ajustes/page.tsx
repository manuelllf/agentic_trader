"use client";

// Ajustes: catálogo que trae su propio texto (grupo, título, ayuda) desde el backend: nada de
// claves JSON en crudo. Los interruptores se cambian en la lista; los números, en una hoja.

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { useConfirmar } from "@/components/Confirmar";
import { ApiError, del, get, put } from "@/lib/api";
import { tokenSesion } from "@/lib/liga/supabase";
import { Celda, CeldaInterruptor, Esqueleto, Grupo, Hoja } from "../../_panel/ui";
import { dolares as dolaresFmt } from "../../_marco/formato";
import { claveTituloAjuste } from "./etiquetas";
import "./ajustes.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Tipo = "interruptor" | "entero" | "dolares" | "multiplicador";
type GrupoAjuste = "Emergencia" | "IA" | "Créditos" | "Procesos" | "Premio" | "Liga" | "Panel";
type Valor = boolean | number | null;

type Ajuste = {
  clave: string; grupo: GrupoAjuste; titulo: string; ayuda: string; tipo: Tipo; unidad: string | null;
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

// Solo los interruptores de IA llevan finalidad (para la razón por la que no funcionan, de /ia/estado).
const FINALIDAD_POR_CLAVE: Record<string, Finalidad> = {
  "ia.conversor.activo": "conversor", "ia.pregunta.activo": "pregunta",
  "ia.lectura.activo": "lectura", "ia.formacion.activo": "formacion",
};
const ORDEN_GRUPOS: GrupoAjuste[] = ["Emergencia", "IA", "Créditos", "Procesos", "Premio", "Liga", "Panel"];

const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Ajustes() {
  const t = useTranslations();
  const { confirmar, dialogo } = useConfirmar();
  const locale = useLocale();
  const dolares = (v: string) => dolaresFmt(v, locale);

  const grupoLabel = (g: GrupoAjuste) => t({ Emergencia: "admin_settings_group_emergency", IA: "admin_settings_group_ai", "Créditos": "admin_settings_group_credits", Premio: "admin_settings_group_prize", Liga: "admin_settings_group_league", Procesos: "admin_settings_group_processes", Panel: "admin_settings_group_panel" }[g]);
  const ajustesLabel = (a: Ajuste) => {
    const titulo = claveTituloAjuste(a.clave);
    const suffix = titulo?.replace(/^admin_setting_|_title$/g, "");
    if (titulo?.startsWith("admin_settings_panel_")) return { title: t(titulo), help: t(titulo.replace(/_titulo$/, "_ayuda")) };
    return suffix ? { title: t(titulo!), help: t(`admin_setting_${suffix}_help`) } : { title: a.titulo, help: a.ayuda };
  };
  const unidad = (a: Ajuste) => (a.unidad === "créditos" ? t("admin_settings_credits_unit") : a.unidad ?? "");
  const valor = (a: Ajuste, v: Valor) => {
    if (v == null) return t("admin_settings_unspecified");
    if (a.tipo === "interruptor") return v ? t("admin_settings_on") : t("admin_settings_off");
    return `${new Intl.NumberFormat(locale).format(Number(v))}${unidad(a) ? ` ${unidad(a)}` : ""}`;
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
  const [editando, setEditando] = useState<Ajuste | null>(null);
  const [borrador, setBorrador] = useState("");

  const cargar = useCallback(() => {
    setFallo("");
    Promise.all([get<Ajuste[]>("/liga/admin/ajustes"), get<EstadoIA>("/liga/admin/ia/estado")])
      .then(([lista, estado]) => { setAjustes(lista); setEstadoIA(estado); })
      .catch((e) => setFallo(errorText(e)));
  }, [errorText]);
  useEffect(cargar, [cargar]);

  const marcarGuardado = (clave: string) => {
    setGuardadoOk(clave);
    setTimeout(() => setGuardadoOk((c) => (c === clave ? null : c)), 2000);
  };
  const refrescarEstadoIA = () => { get<EstadoIA>("/liga/admin/ia/estado").then(setEstadoIA).catch(() => {}); };

  const guardarInterruptor = async (a: Ajuste, nuevo: boolean) => {
    if (a.grupo === "IA" && nuevo
        && !(await confirmar({ titulo: t("pnl_sistema_ia_confirma_titulo"), texto: t("pnl_sistema_ia_confirma_texto"), aceptar: t("pnl_sistema_ia_confirma_aceptar") }))) {
      return;
    }
    setOcupada(a.clave); setErroresFila((e) => ({ ...e, [a.clave]: "" }));
    try {
      const fila = await put<Ajuste>(`/liga/admin/ajustes/${encodeURIComponent(a.clave)}`, { valor: nuevo });
      setAjustes((prev) => prev!.map((x) => (x.clave === a.clave ? fila : x)));
      marcarGuardado(a.clave);
      // El interruptor pudo mover si una finalidad de IA funciona ahora; refresca su estado.
      refrescarEstadoIA();
    } catch (e) {
      setErroresFila((er) => ({ ...er, [a.clave]: errorText(e) }));
    } finally {
      setOcupada(null);
    }
  };

  const abrirValor = (a: Ajuste) => {
    setBorrador(String(a.valor ?? a.efectivo ?? ""));
    setErroresFila((e) => ({ ...e, [a.clave]: "" }));
    setEditando(a);
  };

  const guardarNumero = async (a: Ajuste) => {
    const numero = Number(borrador.replace(",", "."));
    if (borrador.trim() === "" || Number.isNaN(numero)) {
      setErroresFila((e) => ({ ...e, [a.clave]: t("admin_settings_number_error") }));
      return;
    }
    setOcupada(a.clave); setErroresFila((e) => ({ ...e, [a.clave]: "" }));
    try {
      const fila = await put<Ajuste>(`/liga/admin/ajustes/${encodeURIComponent(a.clave)}`, { valor: numero });
      setAjustes((prev) => prev!.map((x) => (x.clave === a.clave ? fila : x)));
      marcarGuardado(a.clave);
      setEditando(null);
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
      marcarGuardado(a.clave);
      setEditando(null);
      if (a.grupo === "IA") refrescarEstadoIA();
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
      const enlace = document.createElement("a");
      enlace.href = url; enlace.download = nombre;
      document.body.appendChild(enlace); enlace.click(); enlace.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setFallo(errorText(e)); } finally { setCopiaOcupado(false); }
  };

  const razones = estadoIA?.finalidades.filter(f => !f.funciona && f.razon).map(f => f.razon!) ?? [];
  const compartidas = [...new Set(razones.filter(r => razones.filter(x => x === r).length > 1))];
  const guardadoEditando = editando ? (editando.valor ?? editando.efectivo) : null;
  const cambiado = editando
    ? (borrador.trim() === "" ? guardadoEditando != null : guardadoEditando == null || Number(borrador.replace(",", ".")) !== Number(guardadoEditando))
    : false;
  const errorHoja = editando ? erroresFila[editando.clave] : "";
  const tieneValorPropio = editando?.valor != null && editando.valor !== editando.defecto;
  const rango = editando
    ? editando.minimo != null && editando.maximo != null ? t("pnl_sistema_ajuste_rango", { min: editando.minimo, max: editando.maximo })
      : editando.minimo != null ? t("pnl_sistema_ajuste_minimo", { min: editando.minimo })
      : editando.maximo != null ? t("pnl_sistema_ajuste_maximo", { max: editando.maximo }) : ""
    : "";
  const titulosFila = editando ? ajustesLabel(editando) : null;
  const erroresAbiertos = Object.entries(erroresFila).filter(([clave, texto]) => texto && clave !== editando?.clave);

  return (
    <div className="pnl-llega">
      {fallo && <p className="pnl-pie-grupo" role="alert">{fallo}</p>}
      {erroresAbiertos.map(([clave, texto]) => {
        const a = ajustes?.find(x => x.clave === clave);
        return <p key={clave} className="ps-aviso fallo" role="alert">{a ? t("pnl_sistema_ajuste_error", { titulo: ajustesLabel(a).title, error: texto }) : texto}</p>;
      })}
      {guardadoOk && <p className="ps-aviso" role="status">{t("admin_settings_saved")}</p>}
      {!ajustes || !estadoIA ? !fallo && <Esqueleto filas={5} etiqueta={t("pnl_sistema_cargando")} /> : ORDEN_GRUPOS.map(grupo => {
        const filas = ajustes.filter(a => a.grupo === grupo && a.clave !== "ia.margen_objetivo");
        if (!filas.length) return null;
        const pie = grupo === "IA" ? (
          <>
            {t("admin_settings_spending", { gasto: dolares(estadoIA.gasto_mes_usd), tope: estadoIA.tope_mensual_usd == null ? t("admin_settings_no_cap") : dolares(estadoIA.tope_mensual_usd), formacion: dolares(estadoIA.gasto_formacion_usd) })}
            {compartidas.map(r => <span key={r} className="ps-razon">{reasonLabel(r)}</span>)}
          </>
        ) : undefined;
        return (
          <Grupo key={grupo} cabecera={grupoLabel(grupo)} pie={pie}>
            {filas.flatMap(a => {
              const etiqueta = ajustesLabel(a);
              const estado = estadoIA.finalidades.find(f => f.finalidad === FINALIDAD_POR_CLAVE[a.clave]);
              const razon = estado && !estado.funciona && estado.razon && !compartidas.includes(estado.razon) ? reasonLabel(estado.razon) : null;
              const subtitulo = razon ? <>{etiqueta.help}<span className="ps-razon">{razon}</span></> : etiqueta.help;
              if (a.tipo === "interruptor") {
                const celdas = [<CeldaInterruptor key={a.clave} titulo={etiqueta.title} subtitulo={subtitulo} activo={a.efectivo === true}
                  deshabilitado={ocupada === a.clave} onCambio={v => void guardarInterruptor(a, v)} />];
                if (a.valor != null && a.valor !== a.defecto) {
                  celdas.push(<Celda key={`${a.clave}-volver`} titulo={t("admin_settings_reset_value", { value: valor(a, a.defecto) })} subtitulo={etiqueta.title}
                    tono="accion" deshabilitada={ocupada === a.clave} onClick={() => void restablecer(a)} />);
                }
                return celdas;
              }
              return [<Celda key={a.clave} titulo={etiqueta.title} subtitulo={subtitulo} valor={valor(a, a.efectivo)} onClick={() => abrirValor(a)} />];
            })}
          </Grupo>
        );
      })}
      <Grupo cabecera={t("admin_settings_tools")} pie={t("pnl_sistema_copia_pie")}>
        <Celda titulo={t(copiaOcupado ? "admin_liga_copy_loading" : "admin_liga_copy_download")} tono="accion" deshabilitada={copiaOcupado} onClick={() => void descargarCopia()} />
      </Grupo>
      <Hoja abierta={editando !== null} titulo={titulosFila && titulosFila.title.length <= 26 ? titulosFila.title : t("pnl_sistema_ajuste_hoja")}
        cancelar={t("common_cancelar")} accion={t("admin_settings_save")} accionDesactivada={!cambiado || (editando !== null && ocupada === editando.clave)}
        onAccion={() => { if (editando) void guardarNumero(editando); }} onCerrar={() => setEditando(null)}>
        {editando && titulosFila && (
          <div className="ps-hoja">
            <label className="ps-campo">
              <span>{titulosFila.title}</span>
              <input type="text" inputMode={editando.tipo === "entero" ? "numeric" : "decimal"} autoComplete="off" value={borrador}
                aria-label={titulosFila.title} onChange={e => setBorrador(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && cambiado && ocupada !== editando.clave) void guardarNumero(editando); }} />
              {unidad(editando) && <em>{unidad(editando)}</em>}
            </label>
            <p className="pnl-pie-grupo">{[titulosFila.help, rango].filter(Boolean).join(" ")}</p>
            {errorHoja && <p className="ps-aviso fallo" role="alert">{errorHoja}</p>}
            {tieneValorPropio && (
              <Grupo>
                <Celda titulo={t("admin_settings_reset_value", { value: valor(editando, editando.defecto) })} tono="accion"
                  deshabilitada={ocupada === editando.clave} onClick={() => void restablecer(editando)} />
              </Grupo>
            )}
          </div>
        )}
      </Hoja>
      {dialogo}
    </div>
  );
}

export default function AjustesAdmin() { return <AuthGate><Ajustes /></AuthGate>; }
