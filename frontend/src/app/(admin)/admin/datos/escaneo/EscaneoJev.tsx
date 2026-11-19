"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  fetchAnalyticsCosteEtapa, fetchAnalyticsScans, fetchScanAudit, getScanFull, getScanOutcomes, getScanReport,
  type ScanAuditEntry, type ScanReport,
} from "@/lib/api";
import { dolares, fechaCorta, fechaHora, numero, porcentajeConSigno, porcentajeSimple } from "../../_marco/formato";
import { Buscador, Celda, Esqueleto, Grupo, Vacio } from "../../_panel/ui";
import { porNotas, tono } from "./escaneo";
import { useLectura } from "./useLectura";
import "../datos.css";

const TICKER = /^[A-Za-z0-9.\-]{1,10}$/;
const ESPERA_MS = 400;

type Texto = (clave: string, valores?: Record<string, string | number>) => string;

function UltimoEscaneo({ r, t, locale }: { r: ScanReport; t: Texto; locale: string }) {
  const u = r.universe;
  const universo = !u ? null
    : t(u.fuente === "cierre" ? "pnl_datos_esc_universo_cierre" : u.fuente === "vivo" ? "pnl_datos_esc_universo_vivo" : "pnl_datos_esc_universo_seed",
      { n: numero(u.size, locale), dias: u.dias ?? 0 });
  return (
    <>
      {r.error && <Grupo cabecera={t("pnl_datos_esc_fallo_cab")}><Celda titulo={r.error} /></Grupo>}
      {!r.error && (
        <Grupo cabecera={t("pnl_datos_esc_ultimo")}>
          <Celda titulo={t("pnl_datos_esc_fecha")} valor={fechaHora(r.at, locale)} />
          <Celda titulo={t("pnl_datos_esc_tipo")} valor={t(r.decide ? "pnl_datos_esc_oficial" : "pnl_datos_esc_prueba")} />
          {universo && <Celda titulo={t("pnl_datos_esc_universo_de")} subtitulo={universo} />}
          {r.prescored != null && r.scanned != null && (
            <Celda titulo={t("pnl_datos_esc_puntuadas")}
              valor={t("pnl_datos_esc_puntuadas_valor", { puntuadas: numero(r.prescored, locale), vistas: numero(r.scanned, locale) })} />
          )}
          {r.cost && (
            <Celda titulo={t("pnl_datos_esc_coste")}
              valor={t("pnl_datos_esc_coste_valor", { usd: dolares(r.cost.cost_usd, locale, 2), llamadas: numero(r.cost.calls, locale) })} />
          )}
          {r.jev_macro != null && (
            <Celda titulo={t("pnl_datos_esc_macro_visto")} subtitulo={t(r.jev_macro ? "pnl_datos_esc_macro_con" : "pnl_datos_esc_macro_sin")} />
          )}
        </Grupo>
      )}
      {r.issues.length > 0 && (
        <Grupo cabecera={t("pnl_datos_esc_avisos")}>
          {r.issues.map(texto => <Celda key={texto} titulo={texto} />)}
        </Grupo>
      )}
      {(r.jev_cartera ?? []).length > 0 && (
        <Grupo cabecera={t("pnl_datos_esc_lambda")} pie={t("pnl_datos_esc_lambda_pie")}>
          {r.jev_cartera!.map(p => (
            <Celda key={p.ticker} titulo={p.ticker}
              subtitulo={t("pnl_datos_esc_lambda_sub", {
                industria: p.industry || "-",
                confianza: p.confidence == null ? "-" : porcentajeSimple(p.confidence * 100, locale, 0),
              })}
              valor={t("pnl_datos_esc_lambda_valor", {
                nota: new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(p.score),
                peso: porcentajeSimple(p.weight_pct, locale, 0),
              })} />
          ))}
        </Grupo>
      )}
    </>
  );
}

function Predice({ t, locale }: { t: Texto; locale: string }) {
  const { estado, datos } = useLectura(() => getScanOutcomes(1));
  if (estado === "cargando") return <Esqueleto filas={6} etiqueta={t("admin_pnl_cargando")} />;
  const escaneo = datos?.scans[0];
  const grupos = escaneo ? porNotas(escaneo.pairs) : [];
  if (estado === "error" || !escaneo || grupos.length === 0) {
    return <Vacio titulo={t("pnl_datos_esc_predice_vacio")} texto={t("pnl_datos_esc_predice_vacio_texto")} />;
  }
  return (
    <Grupo cabecera={t("pnl_datos_esc_predice")}
      pie={t("pnl_datos_esc_predice_pie", { fecha: fechaCorta(escaneo.at, locale), dias: escaneo.days, n: numero(escaneo.pairs.length, locale) })}>
      {grupos.map((g, i) => (
        <Celda key={i} titulo={t(`pnl_datos_esc_q${i + 1}`)} subtitulo={t("pnl_datos_esc_q_n", { n: numero(g.n, locale) })}
          valor={g.media === null ? "-" : <span className={tono(g.media)}>{porcentajeConSigno(g.media, locale, 1)}</span>} />
      ))}
      {escaneo.groups.spy != null && (
        <Celda titulo={t("pnl_datos_esc_spy")} valor={porcentajeConSigno(escaneo.groups.spy, locale, 1)} />
      )}
    </Grupo>
  );
}

/** El bloque macro que vio la nota: calendario, eventos y titulares guardados con el escaneo. */
function DetalleMacro({ t }: { t: Texto }) {
  const { estado, datos } = useLectura(async () => (await getScanFull()).scan);
  if (estado === "cargando") return <Esqueleto filas={3} etiqueta={t("admin_pnl_cargando")} />;
  if (estado === "error") return <p className="pnl-pie-grupo" role="alert">{t("admin_generic_error")}</p>;
  if (!datos) return null;
  const sinContexto = !datos.macro_calendario && !datos.macro_eventos && datos.macro_titulares.length === 0;
  return (
    <>
      <h2 className="pnl-cab-grupo">{t("pnl_datos_esc_detalle")}</h2>
      {sinContexto && <p className="pnl-pie-grupo">{t("pnl_datos_esc_det_vacio")}</p>}
      {datos.macro_calendario && (
        <Grupo cabecera={t("pnl_datos_esc_det_calendario")}><p className="pnl-pie-grupo">{datos.macro_calendario}</p></Grupo>
      )}
      {datos.macro_eventos && (
        <Grupo cabecera={t("pnl_datos_esc_det_eventos")}><p className="pnl-pie-grupo">{datos.macro_eventos}</p></Grupo>
      )}
      {datos.macro_titulares.length > 0 && (
        <Grupo cabecera={t("pnl_datos_esc_det_titulares")}>
          {datos.macro_titulares.map((h, i) => <Celda key={i} titulo={h.texto} subtitulo={h.fuente} />)}
        </Grupo>
      )}
    </>
  );
}

interface FilaCoste { stage: string; llamadas: number; usd: number; cache_hit_pct: number | null; fallos: number }

function CostePorEtapa({ t, locale }: { t: Texto; locale: string }) {
  // Del escaneo más reciente: su id sale de la lista de escaneos de la analítica.
  const { estado, datos } = useLectura(async () => {
    const { items } = await fetchAnalyticsScans();
    if (!items.length) return [] as FilaCoste[];
    return (await fetchAnalyticsCosteEtapa(items[0].id)).items as unknown as FilaCoste[];
  });
  if (estado === "cargando") return <Esqueleto filas={4} etiqueta={t("admin_pnl_cargando")} />;
  if (estado === "error") return <p className="pnl-pie-grupo" role="alert">{t("pnl_datos_esc_coste_sin_datos")}</p>;
  if (!datos || datos.length === 0) return null;
  return (
    <Grupo cabecera={t("pnl_datos_esc_coste_etapa")}>
      {datos.map(f => (
        <Celda key={f.stage} titulo={f.stage}
          subtitulo={[t("pnl_datos_esc_etapa_sub", { llamadas: numero(f.llamadas, locale), cache: f.cache_hit_pct == null ? "-" : porcentajeSimple(f.cache_hit_pct, locale, 0) }),
            f.fallos ? t("pnl_datos_esc_etapa_fallos", { fallos: numero(f.fallos, locale) }) : ""].filter(Boolean).join(" · ")}
          valor={dolares(f.usd, locale, 3)} />
      ))}
    </Grupo>
  );
}

function UnaEmpresa({ t, locale }: { t: Texto; locale: string }) {
  const [texto, setTexto] = useState("");
  const [historia, setHistoria] = useState<{ ticker: string; scans: ScanAuditEntry[] } | null | "error">(null);
  useEffect(() => {
    const ticker = texto.trim();
    if (!TICKER.test(ticker)) { setHistoria(null); return; }
    let vivo = true;
    const espera = setTimeout(() => {
      fetchScanAudit(ticker).then(r => { if (vivo) setHistoria(r); }).catch(() => { if (vivo) setHistoria("error"); });
    }, ESPERA_MS);
    return () => { vivo = false; clearTimeout(espera); };
  }, [texto]);
  return (
    <>
      <h2 className="pnl-cab-grupo">{t("pnl_datos_esc_empresa")}</h2>
      <Buscador valor={texto} onCambio={setTexto} etiqueta={t("pnl_datos_esc_empresa")} placeholder={t("pnl_datos_esc_empresa_buscar")} />
      {historia === "error" && <p className="pnl-pie-grupo" role="alert">{t("admin_generic_error")}</p>}
      {historia && historia !== "error" && (historia.scans.length === 0
        ? <p className="pnl-pie-grupo">{t("pnl_datos_esc_empresa_sin", { ticker: historia.ticker })}</p>
        : (
          <Grupo pie={t("pnl_datos_esc_empresa_pie")}>
            {historia.scans.map(s => (
              <Celda key={s.at} titulo={fechaCorta(s.at, locale)}
                subtitulo={t("pnl_datos_esc_empresa_fila", { etapa: s.stage, precio: s.price != null ? dolares(s.price, locale, 2) : "-" })}
                valor={s.prescore != null ? t("pnl_datos_esc_empresa_nota", { nota: numero(s.prescore, locale) }) : "-"} />
            ))}
          </Grupo>
        ))}
      {!historia && <p className="pnl-pie-grupo">{t("pnl_datos_esc_empresa_pie")}</p>}
    </>
  );
}

/** Lo que dejó el último escaneo de Jev: cómo fue, la cartera de Lambda, si la nota predice, lo que costó y una empresa. */
export default function EscaneoJev() {
  const t = useTranslations();
  const locale = useLocale();
  const informe = useLectura(async () => (await getScanReport()).report);
  return (
    <div className="pnl-llega">
      {informe.estado === "cargando" && <Esqueleto filas={6} etiqueta={t("admin_pnl_cargando")} />}
      {informe.estado === "error" && <p className="pnl-pie-grupo" role="alert">{t("admin_generic_error")}</p>}
      {informe.estado === "listo" && !informe.datos && (
        <Vacio titulo={t("pnl_datos_esc_sin_escaneo")} texto={t("pnl_datos_esc_sin_escaneo_texto")} />
      )}
      {informe.datos && <UltimoEscaneo r={informe.datos} t={t} locale={locale} />}
      {informe.datos && !informe.datos.error && <Predice t={t} locale={locale} />}
      {informe.datos && !informe.datos.error && <DetalleMacro t={t} />}
      {informe.datos && <CostePorEtapa t={t} locale={locale} />}
      <UnaEmpresa t={t} locale={locale} />
    </div>
  );
}
