"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  getPortada, getPremio, getPremioYo, type Portada, type PremioPublico, type PremioYo,
} from "@/lib/liga/api";
import { useCache } from "@/lib/liga/cache";
import { useSesion } from "../_sesion/SesionContext";
import { BarraPestanas, Cargando, ErrorLiga } from "../_ui";

type Temporada = Portada["temporada"];

function Cabecera() {
  const t = useTranslations();
  return <header className="cab centrada">
    <Link href="/liga" aria-label={t("premio_volver")} className="premio-volver">
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        aria-hidden="true"><path d="m14 5-7 7 7 7" /></svg>
    </Link>
    <h1 className="cab-titulo">{t("premio_titulo")}</h1>
    <span className="premio-cab-hueco" aria-hidden="true" />
  </header>;
}

function Intro({ temporada }: { temporada: Temporada }) {
  const t = useTranslations();
  const nombre = temporada?.clave === "pretemporada" ? t("league_pretemporada")
    : temporada?.clave === "temporada_1" ? t("league_temporada_1") : temporada?.nombre;
  return <section className="sec">
    {temporada && <p className="premio-eyebrow">
      {t("premio_temporada", { nombre: nombre ?? "", n: temporada.n_jornadas })}
    </p>}
    <h2 className="premio-titular">{t("premio_intro_titulo")}</h2>
    <p className="premio-intro">{t("premio_intro_texto")}</p>
  </section>;
}

function CuentasOptan({ premio }: { premio: PremioPublico }) {
  const t = useTranslations();
  const cuentas = premio.cuentas ?? 0;
  const basico = premio.umbral_basico ?? 0;
  const completo = premio.umbral_completo ?? 0;
  const escalon = premio.escalon ?? 0;
  const completos = premio.importes?.["2"] ?? [];
  const importe = (n: number) => t("premio_importe", { n });
  const marca = completo > 0 ? Math.min(basico / completo, 1) * 100 : 0;
  const avance = completo > 0 ? Math.min(cuentas / completo, 1) * 100 : 0;
  const meta = escalon === 0 ? t("premio_meta_activar", { basico }) : escalon === 1
    ? t("premio_meta_completo", { completo }) : t("premio_meta_completo_en_juego");
  const mensaje = premio.calculado ? t("premio_calculado", { escalon }) : escalon === 0
    ? t("premio_mensaje_faltan", { faltan: Math.max(0, basico - cuentas) }) : escalon === 1
    ? t("premio_mensaje_primer", { faltan: Math.max(0, completo - cuentas) })
    : t("premio_mensaje_completo", {
      a: importe(completos[0] ?? 0), b: importe(completos[1] ?? 0),
      c: importe(completos[2] ?? 0),
    });
  return <section className="tarjeta premio-tarjeta">
    <div className="premio-cuentas-cab">
      <b>{t("premio_cuentas_optan")}</b>
      <span className="fine">{t(premio.calculado ? "premio_cerrado" : "premio_hoy")}</span>
    </div>
    <div className="premio-cuentas-dato">
      <strong className="premio-cifra">{cuentas}</strong><span className="meta">{meta}</span>
    </div>
    <div aria-hidden="true" className="premio-escala">
      <div className="premio-barra">
        <div className="premio-barra-relleno" style={{ width: `${avance}%` }} />
      </div>
      {Array.from({ length: 11 }, (_, i) => <span key={i} className="premio-escala-marca"
        style={{ left: `${i * 10}%` }} />)}
      <span className="premio-marca" style={{ left: `${marca}%` }} />
      {[{ n: 0, porcentaje: 0 }, { n: basico, porcentaje: marca },
        { n: completo, porcentaje: 100 }].map(({ n, porcentaje }, i) => (
        <span key={i} className="fine premio-escala-etiqueta" style={{
          left: `${porcentaje}%`,
          transform: `translateX(${i === 0 ? 0 : i === 2 ? -100 : -50}%)`,
        }}>{n}</span>
      ))}
    </div>
    <p className="meta">{mensaje}</p>
  </section>;
}

function Importes({ premio }: { premio: PremioPublico }) {
  const t = useTranslations();
  const basico = premio.umbral_basico ?? 0;
  const completo = premio.umbral_completo ?? 0;
  const escalon = premio.escalon ?? 0;
  const importes = premio.importes ?? {};
  return <section className="sec">
    <h2 className="sec-t">{t("premio_importes_titulo")}</h2>
    <p className="meta">{t("premio_importes_texto")}</p>
    <table className="premio-tabla">
      <thead><tr><td />{[basico, completo].map((n, i) => (
        <th scope="col" key={i}
          className={`premio-celda premio-columna${escalon === i + 1 ? " activa" : ""}`}>
          {t("premio_columna", { n })}
          {escalon === i + 1 && <span className="fine premio-en-juego">
            {t("premio_en_juego")}
          </span>}
        </th>
      ))}</tr></thead>
      <tbody>{[0, 1, 2].map((i) => <tr key={i}>
        <th scope="row" className="premio-puesto">{t(`premio_puesto_${i + 1}`)}</th>
        {[1, 2].map((e) => <td key={e}
          className={`num premio-celda premio-importe${escalon === e ? " activa" : ""}`}>
          {t("premio_importe", { n: importes[String(e)]?.[i] ?? 0 })}
        </td>)}
      </tr>)}</tbody>
    </table>
    {escalon === 0 && <p className="fine premio-sin-premio">
      {t("premio_sin_premio", { n: basico })}
    </p>}
  </section>;
}

function EdadFila({ cuenta }: { cuenta: PremioYo }) {
  const t = useTranslations();
  const mayor = cuenta.edad === "mayor";
  const texto = mayor ? "premio_edad_mayor"
    : cuenta.edad === "menor" ? "premio_edad_menor" : "premio_edad_sin";
  return <div className="li premio-edad">
    <span aria-hidden="true" className={`premio-check${mayor ? " cumple" : ""}`}>
      {mayor && <svg width={14} height={14} viewBox="0 0 20 20" fill="none"
        stroke="currentColor"><path d="m4 10 4 4 8-8" /></svg>}
    </span>
    <div><b>{t("premio_edad")}</b><small>{t(texto)}</small>
      {cuenta.edad === "sin_declarar" && <Link href="/completar" className="premio-declarar">
        {t("premio_edad_declarar")}
      </Link>}
    </div>
  </div>;
}

function EstrategiaFila({ cuenta }: { cuenta: PremioYo }) {
  const t = useTranslations();
  return <Link href="/mias" className="li"><div>
    <b>{t("premio_estrategia")}</b>
    <small>{cuenta.estrategia ? t("premio_estrategia_cambiar", {
      nombre: cuenta.estrategia.nombre, mias: t("common_mias"),
    }) : t("premio_estrategia_elegir", { mias: t("common_mias") })}</small>
  </div></Link>;
}

function JornadasFila({ cuenta, temporada }: { cuenta: PremioYo; temporada: Temporada }) {
  const t = useTranslations();
  if (!temporada) return null;
  return <div className="li"><div className="premio-jornadas">
    <b>{t("premio_jornadas")}</b>
    <div role="img" className="premio-casillas" aria-label={t("premio_jornadas_aria", {
      j: cuenta.jornadas_jugadas, n: temporada.n_jornadas,
    })}>
      {Array.from({ length: temporada.n_jornadas }, (_, i) => (
        <span aria-hidden="true" key={i}
          className={`premio-casilla${i < cuenta.jornadas_jugadas ? " jugada" : ""}`} />
      ))}
    </div>
    <small>{t(cuenta.jornadas_jugadas >= cuenta.minimo_jornadas
      ? "premio_jornadas_cumple" : "premio_jornadas_faltan", {
      j: cuenta.jornadas_jugadas, n: temporada.n_jornadas, minimo: cuenta.minimo_jornadas,
      faltan: Math.max(0, cuenta.minimo_jornadas - cuenta.jornadas_jugadas),
    })}</small>
  </div></div>;
}

function ErrorPremio({ mensaje, reintentar }: { mensaje: string; reintentar: () => void }) {
  const t = useTranslations();
  return <ErrorLiga titulo={t("premio_titulo")} mensaje={mensaje}
    accion={{ texto: t("league_reintentar"), onClick: reintentar }} />;
}

function TuCuenta({ temporada, sesion, propio, fallo, refrescar }: {
  temporada: Temporada;
  sesion: boolean;
  propio: PremioYo | string | undefined;
  fallo: boolean;
  refrescar: () => void;
}) {
  const t = useTranslations();
  const cuenta = sesion && typeof propio === "object" ? propio : null;
  return <section className="sec">
    <div className="premio-cuenta-cab">
      <h2 className="sec-t">{t("premio_tu_cuenta")}</h2>
      {cuenta && <span className={`premio-pill${cuenta.optas ? " optas" : ""}`}>
        {t(cuenta.optas ? "premio_optas" : "premio_no_optas")}
      </span>}
    </div>
    {!sesion ? <>
      <p className="meta">{t("premio_sesion")}</p>
      <Link href="/entrar?next=/premio" className="btn pri wide premio-entrar">
        {t("league_entrar")}
      </Link>
    </> : typeof propio === "string" || fallo ? <ErrorPremio
      mensaje={typeof propio === "string" ? propio : t("league_error_portada")}
      reintentar={refrescar} /> : !cuenta ? <Cargando filas={3} /> : <div className="tarjeta">
      <EdadFila cuenta={cuenta} />
      <EstrategiaFila cuenta={cuenta} />
      <JornadasFila cuenta={cuenta} temporada={temporada} />
    </div>}
  </section>;
}

export function PaginaPremio() {
  const t = useTranslations();
  const { yo } = useSesion();
  const { datos: propio, fallo: falloPropio, refrescar: refrescarPropio } = useCache<
    PremioYo | string
  >(yo ? "premio-yo" : null, getPremioYo);
  const { datos: premio, fallo, refrescar } = useCache<PremioPublico | string>(
    "premio", getPremio, 120000,
  );
  const { datos: portada } = useCache<Portada | string>("portada", getPortada, 120000);
  const temporada = typeof portada === "object" ? portada.temporada : null;
  let contenido;
  if (typeof premio === "string" || fallo) {
    contenido = <ErrorPremio
      mensaje={typeof premio === "string" ? premio : t("league_error_portada")}
      reintentar={refrescar} />;
  } else if (!premio) {
    contenido = <Cargando filas={4} />;
  } else if (!premio.visible) {
    contenido = <div className="empty"><p>{t("premio_no_visible")}</p>
      <Link href="/liga" className="btn">{t("premio_volver")}</Link>
    </div>;
  } else {
    contenido = <>
      <Intro temporada={temporada} />
      <CuentasOptan premio={premio} />
      <Importes premio={premio} />
      <TuCuenta temporada={temporada} sesion={Boolean(yo)} propio={propio}
        fallo={falloPropio} refrescar={refrescarPropio} />
      <Link href="/legal/bases-premio" className="btn wide premio-bases">
        {t("premio_leer_bases")}
      </Link>
    </>;
  }
  return <main className="scroll"><Cabecera />{contenido}<BarraPestanas /></main>;
}
