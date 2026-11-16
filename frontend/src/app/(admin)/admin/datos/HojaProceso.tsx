"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  contarUniversoGlobal, getPodaPrevia, snapshotUniverse, startFoto, startPoda, subirUniversoGlobalCsv,
  syncAnalytics, syncFx, syncUniversoGlobal, type PodaPrevia, type UniversoGlobalOpciones,
} from "@/lib/api";
import { useConfirmar } from "@/components/Confirmar";
import { numero } from "../_marco/formato";
import { Celda, ChipFiltro, Chips, Grupo, Hoja, Segmentado } from "../_panel/ui";
import { LIMITE_DEFECTO, minutosCaptura, textoHorario, type Horario, type ProcesoId } from "./procesos";
import "./datos.css";

// Para bajarlo a mano si la red del servidor no llega a la fuente.
const URL_CSV = "https://huggingface.co/datasets/adanosorg/free-global-stock-ticker-database/resolve/main/tickers.csv";

export type Accion = () => Promise<string | null>;

interface Props {
  id: ProcesoId | null;
  onCerrar: () => void;
  horario: Horario | null;
  ultima: string;
  dato: string;
  /** Solo para deshabilitar el botón: quien decide si corre es el backend (409). */
  ocupado: boolean;
  global: UniversoGlobalOpciones | null;
  lanzar: (id: ProcesoId, accion: Accion) => void;
}

export function HojaProceso({ id, onCerrar, ...resto }: Props) {
  const t = useTranslations();
  return (
    <Hoja abierta={id !== null} titulo={id ? t(`pnl_datos_p_${id}`) : ""} accion={t("pnl_datos_listo")} onCerrar={onCerrar}>
      {id && <Contenido key={id} id={id} onCerrar={onCerrar} {...resto} />}
    </Hoja>
  );
}

function Contenido({ id, onCerrar, horario, ultima, dato, ocupado, global, lanzar }: Props & { id: ProcesoId }) {
  const t = useTranslations();
  const locale = useLocale();
  const { confirmar, dialogo } = useConfirmar();
  const entrada = horario?.procesos.find(p => p.proceso === id);
  const fichero = useRef<HTMLInputElement>(null);

  // Fundamentales: NASDAQ entero, o el universo global filtrado por país y mercado.
  const [alcance, setAlcance] = useState<"nasdaq" | "global">("nasdaq");
  const [paises, setPaises] = useState<string[]>([]);
  const [mercados, setMercados] = useState<string[]>([]);
  const [limite, setLimite] = useState(String(LIMITE_DEFECTO));
  const [cuenta, setCuenta] = useState<number | null>(null);
  useEffect(() => {
    if (id !== "fund" || alcance !== "global") return;
    let vivo = true;
    setCuenta(null);
    contarUniversoGlobal(paises, mercados).then(r => { if (vivo) setCuenta(r.count); }).catch(() => { if (vivo) setCuenta(null); });
    return () => { vivo = false; };
  }, [id, alcance, paises, mercados]);
  const tope = Math.max(1, Math.floor(Number(limite)) || 1);
  const elegidos = cuenta === null ? null : Math.min(cuenta, tope);
  const alterna = (lista: string[], poner: (v: string[]) => void, v: string) => poner(lista.includes(v) ? lista.filter(x => x !== v) : [...lista, v]);

  // Poda: lo que borraría ahora, antes de poder lanzarla.
  const [previa, setPrevia] = useState<PodaPrevia | null | false>(null);
  useEffect(() => {
    if (id !== "poda") return;
    getPodaPrevia().then(r => setPrevia(r.previa)).catch(() => setPrevia(false));
  }, [id]);

  const lanza = (accion: Accion) => { lanzar(id, accion); onCerrar(); };

  const lanzarFund = async () => {
    const minutos = alcance === "global" ? minutosCaptura(elegidos ?? tope) : 40;
    if (!await confirmar({ titulo: t("pnl_datos_conf_fund_titulo"), texto: t("pnl_datos_conf_fund_texto", { minutos }), aceptar: t("pnl_datos_lanzar") })) return;
    lanza(async () => {
      await startFoto(alcance, alcance === "global" ? tope : undefined, paises, mercados);
      return t("pnl_datos_fund_lanzada", { minutos });
    });
  };
  const lanzarPoda = async () => {
    if (!await confirmar({ titulo: t("pnl_datos_conf_poda_titulo"), texto: t("pnl_datos_conf_poda_texto"), aceptar: t("pnl_datos_podar"), peligro: true })) return;
    lanza(async () => { await startPoda(); return t("pnl_datos_poda_lanzada"); });
  };
  const subirCsv = (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    lanza(async () => { await subirUniversoGlobalCsv(archivo); return t("pnl_datos_csv_subido", { nombre: archivo.name }); });
  };
  // `resolve/main` no fuerza la descarga: se baja como blob para que se guarde en vez de abrirse.
  const descargarCsv = async () => {
    try {
      const url = URL.createObjectURL(await (await fetch(URL_CSV)).blob());
      const a = document.createElement("a");
      a.href = url; a.download = "tickers.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch { window.open(URL_CSV, "_blank"); }
  };

  const accionSimple: Partial<Record<ProcesoId, Accion>> = {
    foto: async () => {
      const r = await snapshotUniverse();
      if (!r.ok) throw new Error(r.error ?? t("pnl_datos_foto_fallo"));
      return t("pnl_datos_foto_hecha", { n: r.size != null ? numero(r.size, locale) : "-" });
    },
    global: async () => { await syncUniversoGlobal(); return t("pnl_datos_global_lanzada"); },
    fx: async () => {
      const r = await syncFx();
      if (!r.ok) throw new Error(r.error ?? t("pnl_datos_fx_fallo"));
      return r.motivo ?? t("pnl_datos_fx_hecho", { divisas: r.divisas ?? 0, n: numero(r.recalculadas ?? 0, locale) });
    },
    analitica: async () => {
      const r = await syncAnalytics();
      return t("pnl_datos_analitica_hecha", { cuentas: Object.entries(r.counts).map(([k, n]) => `${k}: ${n}`).join(", ") });
    },
  };

  const globalVacio = !global || global.total === 0;
  const nadaQuePodar = previa !== null && previa !== false && previa.texto_llm.llamadas === 0;
  const bloqueado = ocupado
    || (id === "poda" && (previa === null || previa === false || nadaQuePodar))
    || (id === "fund" && alcance === "global" && (globalVacio || !cuenta));
  const textoBoton = ocupado ? t("pnl_datos_hay_otro_boton") : id === "poda" ? t("pnl_datos_podar") : t("pnl_datos_lanzar_ahora");
  const alPulsar = id === "fund" ? lanzarFund : id === "poda" ? lanzarPoda : () => lanza(accionSimple[id]!);

  return (
    <div className="pd-pad">
      <Grupo>
        <Celda titulo={t("pnl_datos_que_hace")} subtitulo={t(`pnl_datos_hace_${id}`)} />
        <Celda titulo={t("pnl_datos_cuando")} subtitulo={textoHorario(id, entrada, horario?.scheduler_activo ?? false, t, locale)} />
        <Celda titulo={t("pnl_datos_ultima")} valor={ultima} subtitulo={dato || undefined} />
        <Celda titulo={t("pnl_datos_duracion")} subtitulo={t(`pnl_datos_dura_${id}`)} />
      </Grupo>

      {id === "fund" && (
        <>
          <h2 className="pnl-cab-grupo">{t("pnl_datos_alcance")}</h2>
          <Segmentado etiquetaGrupo={t("pnl_datos_alcance")} valor={alcance} onChange={setAlcance}
            opciones={[{ valor: "nasdaq", etiqueta: "NASDAQ" }, { valor: "global", etiqueta: t("pnl_datos_global") }]} />
          {alcance === "global" && (globalVacio
            ? <p className="pnl-pie-grupo">{t("pnl_datos_sincroniza_primero")}</p>
            : (
              <>
                <p className="pd-etiqueta">{t("pnl_datos_pais")}</p>
                <Chips etiqueta={t("pnl_datos_pais")}>
                  {global.countries.slice(0, 20).map(c => (
                    <ChipFiltro key={c.country} activo={paises.includes(c.country)} onClick={() => alterna(paises, setPaises, c.country)}>
                      {c.country} · {numero(c.count, locale)}
                    </ChipFiltro>
                  ))}
                </Chips>
                <p className="pd-etiqueta">{t("pnl_datos_mercado")}</p>
                <Chips etiqueta={t("pnl_datos_mercado")}>
                  {global.exchanges.slice(0, 20).map(c => (
                    <ChipFiltro key={c.exchange} activo={mercados.includes(c.exchange)} onClick={() => alterna(mercados, setMercados, c.exchange)}>
                      {c.exchange} · {numero(c.count, locale)}
                    </ChipFiltro>
                  ))}
                </Chips>
                <p className="pd-etiqueta">{t("pnl_datos_limite")}</p>
                <input className="pd-campo" type="text" inputMode="numeric" value={limite} aria-label={t("pnl_datos_limite")}
                  onChange={e => setLimite(e.target.value.replace(/\D/g, ""))} style={{ marginTop: 8 }} />
                <p className="pnl-pie-grupo">
                  {cuenta === null ? t("pnl_datos_contando")
                    : t("pnl_datos_fund_resumen", { coinciden: numero(cuenta, locale), captura: numero(elegidos ?? 0, locale), minutos: minutosCaptura(elegidos ?? 0) })}
                </p>
              </>
            ))}
        </>
      )}

      {id === "global" && (
        <>
          <Grupo pie={t("pnl_datos_csv_pie")} className="pd-csv">
            <Celda titulo={t("pnl_datos_csv_subir")} onClick={() => fichero.current?.click()} deshabilitada={ocupado} />
            <Celda titulo={t("pnl_datos_csv_bajar")} onClick={descargarCsv} />
          </Grupo>
          <input ref={fichero} type="file" accept=".csv" className="pd-oculto" onChange={subirCsv} tabIndex={-1} aria-hidden="true" />
        </>
      )}

      {id === "poda" && (
        <>
          <h2 className="pnl-cab-grupo">{t("pnl_datos_vista_previa")}</h2>
          {previa === null && <Grupo><Celda titulo={t("pnl_datos_calculando")} /></Grupo>}
          {previa === false && <p className="pnl-pie-grupo" role="alert">{t("pnl_datos_previa_fallo")}</p>}
          {previa && (
            <Grupo pie={t("pnl_datos_poda_pie", { dias: previa.reglas.dias_texto_llm })}>
              <Celda titulo={t("pnl_datos_libera")} valor={`${previa.mb_total.toLocaleString(locale, { maximumFractionDigits: 1 })} MB`} />
              <Celda titulo={t("pnl_datos_se_vacian")} valor={numero(previa.texto_llm.llamadas, locale)} />
              <Celda titulo={t("pnl_datos_sin_copia")} subtitulo={t("pnl_datos_sin_copia_sub")} valor={numero(previa.texto_llm.sin_archivar, locale)} />
            </Grupo>
          )}
          {nadaQuePodar && <p className="pnl-pie-grupo">{t("pnl_datos_nada_que_podar")}</p>}
        </>
      )}

      <button type="button" className={`pd-lanzar${id === "poda" ? " peligro" : ""}`} disabled={bloqueado} onClick={alPulsar}>{textoBoton}</button>
      {dialogo}
    </div>
  );
}
