"use client";

// Omega: descubrimiento de momentum, independiente del ranker fundamental (Alpha). Nunca ejecuta en IBKR: avisa y
// sugiere; Manuel ejecuta a mano y lo reporta aquí. La señal, los candidatos y el universo son pantallas de la sala
// (dentro de esta misma ruta, cada una con su `?p=`); todo lo demás son hojas.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useConfirmar } from "@/components/Confirmar";
import { ApiError } from "@/lib/api";
import { dolares } from "../_marco/formato";
import { descartarSenal } from "./api";
import { HojaAnadir, HojaCandidato, PantallaCandidatos } from "./components/Candidatos";
import { HojaForm } from "./components/HojaForm";
import { HojaGateLote, HojaGateModelo, HojaHistorial, nombreModelo } from "./components/Hojas";
import { Raiz } from "./components/Raiz";
import { PantallaSenal, type ModoForm } from "./components/Senal";
import { useIdioma } from "./components/ui";
import { useFijarAccionCabecera } from "../_panel/AccionCabecera";
import { HojaUniverso, PantallaUniverso } from "./components/Universo";
import { clasificarCandidatos, costePorLlamada, empatesPorFecha, esViva, separarAlertas } from "./logica";
import type { Candidato, Senal, Validacion } from "./types";
import { useGate, useMensajeTemporal, useOmega } from "./useOmega";

type Pantalla = { t: "raiz" } | { t: "senal"; id: number } | { t: "candidatos" } | { t: "universo" };

// Cada pantalla tiene su dirección y pasa por el historial del navegador: el botón atrás, el gesto de volver y los
// enlaces directos funcionan solos. `prof` cuenta cuántas pantallas de Omega hay detrás de la actual.
const RAIZ: Pantalla = { t: "raiz" };
function direccionDe(p: Pantalla): string {
  const base = window.location.pathname;
  if (p.t === "raiz") return base;
  return p.t === "senal" ? `${base}?p=senal&id=${p.id}` : `${base}?p=${p.t}`;
}
function pantallaDeLaDireccion(): Pantalla {
  const q = new URLSearchParams(window.location.search);
  const p = q.get("p");
  const id = Number(q.get("id"));
  if (p === "senal" && Number.isInteger(id) && id > 0) return { t: "senal", id };
  return p === "candidatos" || p === "universo" ? { t: p } : RAIZ;
}
const profundidad = (): number => Number((window.history.state as { omegaProf?: number } | null)?.omegaProf ?? 0);
type Hoja =
  | { k: "gateLote" } | { k: "modelo" } | { k: "anadir" }
  | { k: "form"; id: number; modo: ModoForm }
  | { k: "candidato"; c: Candidato } | { k: "universo"; ticker: string } | { k: "historial"; s: Senal };

export default function SalaOmega() {
  const t = useTranslations();
  const locale = useIdioma();
  const o = useOmega();
  const gate = useGate(o.recargar);
  const { confirmar, dialogo } = useConfirmar();
  const [pantalla, setPantalla] = useState<Pantalla>(RAIZ);
  const [hoja, setHoja] = useState<Hoja | null>(null);
  const [aviso, setAviso] = useMensajeTemporal();
  const [errorSenal, setErrorSenal] = useState("");
  const [descartando, setDescartando] = useState(false);

  // La dirección manda: al entrar (enlace directo) y cada vez que el navegador va atrás o adelante.
  useEffect(() => {
    const leer = () => { setPantalla(pantallaDeLaDireccion()); window.scrollTo(0, 0); };
    leer();
    window.addEventListener("popstate", leer);
    return () => window.removeEventListener("popstate", leer);
  }, []);

  // El «+» de añadir ticker vive en la cabecera del marco, como en la maqueta, solo en la raíz de la sala.
  const fijarAccion = useFijarAccionCabecera();
  useEffect(() => {
    fijarAccion(pantalla.t === "raiz" ? (
      <button type="button" className="pnl-cab-accion" aria-label={t("omega_ui_anadir_ticker")} onClick={() => setHoja({ k: "anadir" })}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    ) : null);
  }, [pantalla.t, fijarAccion, t]);
  useEffect(() => () => fijarAccion(null), [fijarAccion]);

  const ir = useCallback((p: Pantalla) => {
    window.history.pushState({ ...window.history.state, omegaProf: profundidad() + 1 }, "", direccionDe(p));
    setPantalla(p); setErrorSenal(""); window.scrollTo(0, 0);
  }, []);
  // Con una pantalla de Omega detrás, «volver» es el atrás del navegador; si se entró por enlace directo, a la raíz.
  const volver = useCallback(() => {
    if (profundidad() > 0) { window.history.back(); return; }
    window.history.replaceState({ ...window.history.state, omegaProf: 0 }, "", direccionDe(RAIZ));
    setPantalla(RAIZ); window.scrollTo(0, 0);
  }, []);

  const senal = pantalla.t === "senal" ? (o.alertas ?? []).find((s) => s.id === pantalla.id) ?? null : null;
  // Una señal que ya no está pendiente ni abierta (descartada, vendida del todo) deja de tener pantalla.
  const senalViva = senal && esViva(senal) ? senal : null;
  useEffect(() => {
    if (pantalla.t === "senal" && o.alertas && !senalViva) volver();
  }, [pantalla, o.alertas, senalViva, volver]);

  const { pendientes } = useMemo(() => separarAlertas(o.alertas ?? []), [o.alertas]);
  const empates = useMemo(() => empatesPorFecha(pendientes), [pendientes]);
  const { porRevisar, evaluados } = useMemo(() => clasificarCandidatos(o.candidatos ?? []), [o.candidatos]);
  const modelo = nombreModelo(o.gateProvider);
  const coste = costePorLlamada(o.cuenta);

  // Toda llamada de pago pide confirmación con su coste: lo que ha costado de media cada una hasta ahora.
  const confirmarGate = useCallback((titulo: string, llamadas: number) => {
    const costeTxt = coste != null ? ` ${t("pnl_omega_coste_medio_llamada", { coste: dolares(coste, locale, 3) })}` : "";
    return confirmar({ titulo, aceptar: t("pnl_omega_lanzar"), texto: `${t("pnl_omega_confirm_gate_texto", { count: llamadas, modelo })}${costeTxt}` });
  }, [coste, confirmar, locale, modelo, t]);
  const confirmarGateTicker = useCallback((ticker: string) => confirmarGate(t("pnl_omega_confirm_gate_titulo", { ticker }), 1), [confirmarGate, t]);

  const evaluarLote = async (ids: number[]) => {
    const titulo = t("pnl_omega_confirm_gate_lote", { count: ids.length });
    if (!(await confirmarGate(titulo, ids.length))) return;
    setHoja(null);
    gate.lanzar(ids);
  };
  const gateUno = async (s: Senal) => {
    if (gate.corriendo) return;
    if (await confirmarGateTicker(s.ticker)) gate.lanzar([s.id]);
  };
  const descartar = async (s: Senal) => {
    if (!(await confirmar({ titulo: t("pnl_omega_confirm_descartar", { ticker: s.ticker }), texto: t("pnl_omega_confirm_descartar_texto"), aceptar: t("omega_ui_descartar"), peligro: true }))) return;
    setDescartando(true); setErrorSenal("");
    try {
      const r = await descartarSenal(s.id);
      o.actualizarAlerta(s.id, { estado: r.estado as Senal["estado"] });
    } catch (e) {
      setErrorSenal(e instanceof ApiError ? e.message : t("omega_dismiss_failed"));
    } finally {
      setDescartando(false);
    }
  };

  const gp = gate.progreso;
  const gateTexto = gp ? `${t("omega_gate_progress", { done: gp.hecho, total: gp.total })}${gp.ticker_actual ? ` · ${gp.ticker_actual}` : ""}…` : t("omega_ui_evaluando_titulo");
  const gatePct = gp && gp.total > 0 ? (gp.hecho / gp.total) * 100 : 5;

  const hojaForm = hoja?.k === "form" ? (o.alertas ?? []).find((s) => s.id === hoja.id) : undefined;
  const hojaUni: Validacion | undefined = hoja?.k === "universo" ? (o.validacion ?? []).find((v) => v.ticker === hoja.ticker) : undefined;
  const sinGate = (o.alertas ?? []).filter((s) => s.gate_resultado == null);
  const universoResumen = (() => {
    const v = o.validacion ?? [];
    const apagados = v.filter((x) => x.mantener === false).length;
    return apagados > 0 ? t("omega_universe_active_off", { activos: v.length - apagados, apagados }) : t("pnl_omega_empresas", { count: v.length });
  })();

  return (
    <>
      {pantalla.t === "raiz" && (
        <Raiz o={o} gate={gate} aviso={aviso} alSenal={(id) => ir({ t: "senal", id })} alHistorial={(s) => setHoja({ k: "historial", s })}
          alGateLote={() => setHoja({ k: "gateLote" })} alModelo={() => setHoja({ k: "modelo" })} alCandidatos={() => ir({ t: "candidatos" })}
          alUniverso={() => ir({ t: "universo" })} />
      )}
      {pantalla.t === "senal" && senalViva && (
        <PantallaSenal s={senalViva} grupo={empates.get(senalViva.entry_date) ?? []} precioVivo={o.preciosVivos[senalViva.ticker] ?? null} regimen={o.regimen}
          gateCorriendo={gate.corriendo} gateTexto={gateTexto} gatePct={gatePct} gateError={gate.error} error={errorSenal} ocupado={descartando}
          alVolver={volver} alGate={() => gateUno(senalViva)} alDescartar={() => descartar(senalViva)}
          alForm={(modo) => setHoja({ k: "form", id: senalViva.id, modo })} />
      )}
      {pantalla.t === "candidatos" && (
        <PantallaCandidatos porRevisar={porRevisar} evaluados={evaluados} cargando={o.cargando} alVolver={volver}
          alAbrir={(c) => setHoja({ k: "candidato", c })} alAnadir={() => setHoja({ k: "anadir" })} />
      )}
      {pantalla.t === "universo" && (
        <PantallaUniverso validacion={o.validacion ?? []} cargando={o.cargando} resumen={universoResumen} alVolver={volver}
          alAbrir={(v) => setHoja({ k: "universo", ticker: v.ticker })} />
      )}

      {hoja?.k === "gateLote" && (
        <HojaGateLote pendientes={sinGate} modelo={modelo} corriendo={gate.corriendo} alEvaluar={evaluarLote} alCerrar={() => setHoja(null)} />
      )}
      {hoja?.k === "modelo" && (
        <HojaGateModelo actual={o.gateProvider} ocupado={o.gateProviderOcupado} alElegir={o.cambiarGateProvider} alCerrar={() => setHoja(null)} />
      )}
      {hoja?.k === "form" && hojaForm && (
        <HojaForm s={hojaForm} modo={hoja.modo} precioVivo={o.preciosVivos[hojaForm.ticker] ?? null} alCerrar={() => setHoja(null)}
          alGuardar={(estado, modo) => {
            setHoja(null);
            setAviso(t(modo === "venta" ? "omega_close_recorded" : modo === "aumentar" ? "omega_position_increased" : "omega_ui_posicion_registrada"));
            o.actualizarAlerta(hojaForm.id, { estado });
            if (modo === "ejecutada") volver();
          }} />
      )}
      {hoja?.k === "candidato" && (
        <HojaCandidato key={hoja.c.id} c={hoja.c} confirmarGate={confirmarGateTicker} alCambiar={o.actualizarCandidato} alCerrar={() => setHoja(null)} />
      )}
      {hoja?.k === "anadir" && <HojaAnadir confirmarGate={confirmarGateTicker} alCambiar={o.actualizarCandidato} alCerrar={() => setHoja(null)} />}
      {hoja?.k === "universo" && hojaUni && (
        <HojaUniverso v={hojaUni} alertas={o.alertas ?? []} historial={o.historial ?? []} preciosVivos={o.preciosVivos}
          alCambiar={o.actualizarValidacion} alCerrar={() => setHoja(null)} />
      )}
      {hoja?.k === "historial" && (
        <HojaHistorial s={hoja.s} precioVivo={o.preciosVivos[hoja.s.ticker] ?? null} regimen={o.regimen} alCerrar={() => setHoja(null)} />
      )}
      {dialogo}
    </>
  );
}
