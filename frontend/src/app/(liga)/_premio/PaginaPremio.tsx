"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  getPremio, getPremioYo, misEstrategias,
  type Estrategia, type PremioPublico, type PremioYo,
} from "@/lib/liga/api";
import { useCache } from "@/lib/liga/cache";
import { useSesion } from "../_sesion/SesionContext";
import { BarraPestanas } from "../_ui";
import { CabeceraPagina } from "../_ui/CabeceraPagina";
import "../liga/ranking.css";
import "../_ui/grupos.css";
import "../_ui/paginas.css";

type Temporada = PremioPublico["temporada"];

function Chevron() {
  return <svg className="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m1 1 6 6-6 6" /></svg>;
}

function Check({ si }: { si: boolean }) {
  return <span className={`pg-check${si ? " si" : ""}`} aria-hidden="true">
    {si && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}
      strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}
  </span>;
}

const ICONO_AVISO = <svg className="ico" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={2}
  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <path d="M21.4 7.6 4.6 37a3 3 0 0 0 2.6 4.5h33.6a3 3 0 0 0 2.6-4.5L26.6 7.6a3 3 0 0 0-5.2 0Z" />
  <path d="M24 18v10M24 34v.4" /></svg>;
const ICONO_PERDIDO = <svg className="ico" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={2}
  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <path d="M13 5h15l10 10v28H13z" /><path d="M28 5v10h10" />
  <path d="M22 25a3.5 3.5 0 1 1 4.7 3.3c-.8.3-1.2 1-1.2 1.7v.6M25.5 35.5v.3" /></svg>;

function Vacio({ icono, texto, boton }: {
  icono: React.ReactNode; texto: string; boton: React.ReactNode;
}) {
  const t = useTranslations();
  return <div className="pg-vacio">{icono}<h1>{t("premio_titulo")}</h1><p>{texto}</p>
    <div className="acciones">{boton}</div></div>;
}

function Esqueleto() {
  const fila = (w: number) => <li><div className="cu-celda alta">
    <span className="cu-esq" style={{ width: `${w}%` }} /></div></li>;
  return <div className="pg" aria-busy="true">
    <span className="cu-esq" style={{ width: "40%", height: 12, marginTop: 12 }} />
    <span className="cu-esq" style={{ width: "86%", height: 24, marginTop: 10 }} />
    <ul className="cu-grupo"><li><div className="pg-cifra">
      <span className="cu-esq" style={{ width: "30%", height: 34 }} />
      <span className="cu-esq" style={{ width: "100%", height: 6, marginTop: 16 }} />
    </div></li></ul>
    <ul className="cu-grupo">{fila(60)}{fila(52)}</ul>
    <ul className="cu-grupo">{fila(48)}{fila(66)}{fila(40)}</ul>
  </div>;
}

function Cifra({ premio }: { premio: PremioPublico }) {
  const t = useTranslations();
  const cuentas = premio.cuentas ?? 0;
  const basico = premio.umbral_basico ?? 0;
  const completo = premio.umbral_completo ?? 0;
  const escalon = premio.escalon ?? 0;
  const completos = premio.importes?.["2"] ?? [];
  const importe = (n: number) => t("premio_importe", { n });
  const pos = (n: number) => (completo > 0 ? Math.min((n / completo) * 100, 100) : 0);
  const meta = escalon === 0 ? t("premio_meta_activar", { basico })
    : escalon === 1 ? t("premio_meta_completo", { completo })
    : t("premio_meta_completo_en_juego");
  const mensaje = premio.calculado ? t("premio_calculado", { escalon })
    : escalon === 0 ? t("premio_mensaje_faltan", { faltan: Math.max(0, basico - cuentas) })
    : escalon === 1 ? t("premio_mensaje_primer", { faltan: Math.max(0, completo - cuentas) })
    : t("premio_mensaje_completo", {
      a: importe(completos[0] ?? 0), b: importe(completos[1] ?? 0), c: importe(completos[2] ?? 0),
    });
  return <ul className="cu-grupo"><li>
    <div className="pg-cifra">
      <small>{t("premio_cuentas_optan")} · {t(premio.calculado ? "premio_cerrado" : "premio_hoy")}</small>
      <b>{cuentas}</b>
      <span className="meta">{meta}</span>
      <div className="pg-barra" role="progressbar" aria-valuemin={0} aria-valuemax={completo}
        aria-valuenow={cuentas} aria-label={t("premio_cuentas_optan")}>
        <i style={{ width: `${pos(cuentas)}%` }} />
        <span className="umbral" style={{ left: `${pos(basico)}%` }} />
      </div>
      <div className="pg-ejes">
        <span style={{ left: 0 }}>0</span>
        <span style={{ left: `${pos(basico)}%`, transform: "translateX(-50%)" }}>{basico}</span>
        <span style={{ right: 0 }}>{completo}</span>
      </div>
    </div>
    <p className="pg-mensaje">{mensaje}</p>
  </li></ul>;
}

function Importes({ premio }: { premio: PremioPublico }) {
  const t = useTranslations();
  const escalon = premio.escalon ?? 0;
  const importes = premio.importes ?? {};
  const niveles: [number, number][] = [[1, premio.umbral_basico ?? 0], [2, premio.umbral_completo ?? 0]];
  return <>
    <p className="cu-cab">{t("premio_importes_titulo")}</p>
    <ul className="cu-grupo">
      {niveles.map(([nivel, n]) => (
        <li key={nivel}><div className="cu-celda alta">
          <span className="t">
            <b>{t("premio_importes_con", { n })}</b>
            <small>{(importes[String(nivel)] ?? []).map((v, i) => (
              `${t("learn_g5_puesto", { n: i + 1 })} ${t("premio_importe", { n: v })}`
            )).join(" · ")}</small>
          </span>
          {escalon === nivel ? <span className="valor en-juego">{t("premio_en_juego")}</span> : <span />}
        </div></li>
      ))}
    </ul>
  </>;
}

function FilaEdad({ cuenta }: { cuenta: PremioYo }) {
  const t = useTranslations();
  const texto = cuenta.edad === "mayor" ? "premio_edad_mayor"
    : cuenta.edad === "menor" ? "premio_edad_menor" : "premio_edad_sin";
  return <li><div className="cu-celda req">
    <Check si={cuenta.edad === "mayor"} />
    <span className="t">
      <b>{t("premio_edad")}</b><small>{t(texto)}</small>
      {cuenta.edad === "sin_declarar" && <Link href="/completar" className="pg-a">
        {t("premio_edad_declarar")}
      </Link>}
    </span><span /><span />
  </div></li>;
}

function FilaEstrategia({ cuenta, estrategias }: { cuenta: PremioYo; estrategias: Estrategia[] }) {
  const t = useTranslations();
  const designada = cuenta.estrategia ?? null;
  if (estrategias.length === 0) {
    return <>
      <li><div className="cu-celda req">
        <Check si={false} />
        <span className="t"><b>{t("premio_estrategia")}</b><small>{t("premio_estrategia_ninguna")}</small></span>
        <span /><span />
      </div></li>
      <li><Link href="/crear" className="cu-celda accion"><span>{t("premio_estrategia_crear")}</span></Link></li>
    </>;
  }
  if (estrategias.length === 1) {
    return <li><div className="cu-celda req">
      <Check si />
      <span className="t"><b>{t("premio_estrategia")}</b>
        <small>{estrategias[0].nombre}. {t("premio_estrategia_unica")}</small></span>
      <span /><span />
    </div></li>;
  }
  return <li><Link href="/premio/estrategia" className="cu-celda req">
    <Check si={designada !== null} />
    <span className="t"><b>{t("premio_estrategia")}</b>
      <small>{designada ? designada.nombre : t("premio_sin_elegir")}</small></span>
    <span /><Chevron />
  </Link></li>;
}

function FilaMeses({ cuenta, temporada }: { cuenta: PremioYo; temporada: Temporada }) {
  const t = useTranslations();
  const n = temporada?.n_meses ?? 0;
  if (n === 0) return null;
  const j = cuenta.jornadas_jugadas;
  const minimo = cuenta.minimo_jornadas;
  const cumple = j >= minimo;
  return <li><div className="cu-celda req">
    <Check si={cumple} />
    <span className="t">
      <b>{t("premio_jornadas")}</b>
      <small>{cumple ? t("premio_jornadas_cumple", { j, n })
        : t("premio_jornadas_faltan", { j, minimo, faltan: minimo - j })}</small>
      <span className="pg-meses" style={{ gridTemplateColumns: `repeat(${n},1fr)` }} role="img"
        aria-label={t("premio_jornadas_aria", { j, n })}>
        {Array.from({ length: n }, (_, i) => <i key={i} className={i < j ? "on" : undefined} />)}
      </span>
    </span><span /><span />
  </div></li>;
}

function TuCuenta({ temporada, sesion, propio, fallo, refrescar, estrategias }: {
  temporada: Temporada;
  sesion: boolean;
  propio: PremioYo | string | undefined;
  fallo: boolean;
  refrescar: () => void;
  estrategias: Estrategia[] | undefined;
}) {
  const t = useTranslations();
  const cuenta = sesion && typeof propio === "object" ? propio : null;
  if (!sesion) {
    return <>
      <p className="cu-cab">{t("premio_tu_cuenta")}</p>
      <ul className="cu-grupo"><li><div className="cu-celda texto">{t("premio_sesion")}</div></li></ul>
      <Link href="/entrar?next=/premio" className="cu-boton">{t("league_entrar")}</Link>
    </>;
  }
  if (typeof propio === "string" || fallo) {
    return <>
      <p className="cu-cab">{t("premio_tu_cuenta")}</p>
      <ul className="cu-grupo"><li><div className="cu-celda texto" role="alert">
        {typeof propio === "string" ? propio : t("league_error_portada")}
      </div></li></ul>
      <button type="button" className="cu-boton tintado" onClick={refrescar}>{t("league_reintentar")}</button>
    </>;
  }
  if (!cuenta || !estrategias) {
    return <>
      <p className="cu-cab">{t("premio_tu_cuenta")}</p>
      <ul className="cu-grupo" aria-busy="true">
        {[48, 66, 40].map((w) => <li key={w}><div className="cu-celda alta">
          <span className="cu-esq" style={{ width: `${w}%` }} /></div></li>)}
      </ul>
    </>;
  }
  return <>
    <div className="cu-cab pg-cab-pill">
      <span>{t("premio_tu_cuenta")}</span>
      <span className={`pg-pill${cuenta.optas ? " si" : ""}`}>
        {t(cuenta.optas ? "premio_optas" : "premio_no_optas")}
      </span>
    </div>
    <ul className="cu-grupo reqs">
      <FilaEdad cuenta={cuenta} />
      <FilaEstrategia cuenta={cuenta} estrategias={estrategias} />
      <FilaMeses cuenta={cuenta} temporada={temporada} />
    </ul>
    <p className="cu-pie">
      {t("premio_jornadas_nota")}{estrategias.length > 1 ? ` ${t("premio_estrategia_elegir")}` : ""}
    </p>
  </>;
}

export function PaginaPremio() {
  const t = useTranslations();
  const { yo } = useSesion();
  const { datos: premio, fallo, refrescar } = useCache<PremioPublico | string>(
    "premio", getPremio, 120000,
  );
  const { datos: propio, fallo: falloPropio, refrescar: refrescarPropio } = useCache<PremioYo | string>(
    yo ? "premio-yo" : null, getPremioYo,
  );
  const { datos: estrategias } = useCache<Estrategia[] | string>(
    yo ? "mis-estrategias" : null, misEstrategias,
  );
  let contenido;
  if (typeof premio === "string" || fallo) {
    contenido = <div className="pg"><Vacio icono={ICONO_AVISO}
      texto={typeof premio === "string" ? premio : t("league_error_portada")}
      boton={<button type="button" className="cu-boton tintado" onClick={refrescar}>
        {t("league_reintentar")}</button>} /></div>;
  } else if (!premio) {
    contenido = <Esqueleto />;
  } else if (!premio.visible) {
    contenido = <div className="pg"><Vacio icono={ICONO_PERDIDO} texto={t("premio_no_visible")}
      boton={<Link href="/liga" className="cu-boton tintado">{t("premio_volver")}</Link>} /></div>;
  } else {
    const temporada = premio.temporada ?? null;
    const nombre = temporada?.clave === "pretemporada" ? t("league_pretemporada")
      : temporada?.clave === "temporada_1" ? t("league_temporada_1") : temporada?.nombre ?? "";
    contenido = <div className="pg">
      {temporada && <p className="pg-de">{t("premio_temporada", { nombre, n: temporada.n_meses })}</p>}
      <h1>{t("premio_intro_titulo")}</h1>
      <p className="pg-lead">{t("premio_intro_texto")}</p>
      <Cifra premio={premio} />
      <Importes premio={premio} />
      <TuCuenta temporada={temporada} sesion={Boolean(yo)} propio={propio} fallo={falloPropio}
        refrescar={refrescarPropio}
        estrategias={Array.isArray(estrategias) ? estrategias : undefined} />
      <ul className="cu-grupo"><li>
        <Link href="/legal/bases-premio" className="cu-celda">
          <span>{t("premio_leer_bases")}</span><span /><Chevron />
        </Link>
      </li></ul>
    </div>;
  }
  return <main className="scroll lv-pagina pg-pagina">
    <CabeceraPagina titulo={t("premio_titulo")} />
    {contenido}
    <BarraPestanas />
  </main>;
}
