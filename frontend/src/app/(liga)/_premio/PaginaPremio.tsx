"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  getPremio, getPremioYo, misEstrategias, optarAlPremio,
  type Estrategia, type PremioPublico, type PremioYo,
} from "@/lib/liga/api";
import { invalidar, useCache } from "@/lib/liga/cache";
import { useSesion } from "../_sesion/SesionContext";
import { BarraPestanas, Cargando, ErrorLiga } from "../_ui";

type Temporada = PremioPublico["temporada"];

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
    : temporada?.clave === "temporada_1" ? t("league_temporada_1") : temporada?.nombre ?? "";
  return <section className="sec">
    {temporada && <p className="premio-eyebrow">
      {t("premio_temporada", { nombre, n: temporada.n_meses })}
    </p>}
    <h2 className="premio-titular">{t("premio_intro_titulo")}</h2>
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
  // La escala va de 0 a la cuenta del escalón completo.
  const posicion = (n: number) => (completo > 0 ? Math.min((n / completo) * 100, 100) : 0);
  const meta = escalon === 0 ? t("premio_meta_activar", { basico })
    : escalon === 1 ? t("premio_meta_completo", { completo })
    : t("premio_meta_completo_en_juego");
  const mensaje = premio.calculado ? t("premio_calculado", { escalon })
    : escalon === 0 ? t("premio_mensaje_faltan", { faltan: Math.max(0, basico - cuentas) })
    : escalon === 1 ? t("premio_mensaje_primer", { faltan: Math.max(0, completo - cuentas) })
    : t("premio_mensaje_completo", {
      a: importe(completos[0] ?? 0), b: importe(completos[1] ?? 0), c: importe(completos[2] ?? 0),
    });
  return <section className="premio-tarjeta">
    <div className="premio-cuentas-cab">
      <b>{t("premio_cuentas_optan")}</b>
      <span>{t(premio.calculado ? "premio_cerrado" : "premio_hoy")}</span>
    </div>
    <div className="premio-cuentas-dato">
      <strong className="premio-cifra">{cuentas}</strong>
      <span className="premio-meta">{meta}</span>
    </div>
    <div className="premio-escala" aria-hidden="true">
      <div className="premio-barra">
        <div className="premio-barra-relleno" style={{ width: `${posicion(cuentas)}%` }} />
      </div>
      {Array.from({ length: 11 }, (_, i) => (
        <span key={i} className="premio-escala-marca" style={{ left: `${i * 10}%` }} />
      ))}
      <span className="premio-marca" style={{ left: `${posicion(basico)}%` }} />
      <span className="premio-escala-etiqueta" style={{ left: 0 }}>0</span>
      <span className="premio-escala-etiqueta fuerte"
        style={{ left: `${posicion(basico)}%`, transform: "translateX(-50%)" }}>{basico}</span>
      <span className="premio-escala-etiqueta fuerte" style={{ right: 0 }}>{completo}</span>
    </div>
    <p className="premio-mensaje">{mensaje}</p>
  </section>;
}

function Importes({ premio }: { premio: PremioPublico }) {
  const t = useTranslations();
  const basico = premio.umbral_basico ?? 0;
  const completo = premio.umbral_completo ?? 0;
  const escalon = premio.escalon ?? 0;
  const importes = premio.importes ?? {};
  const linea = (n: number, nivel: number) => {
    const cifras = importes[String(nivel)] ?? [];
    const [a, b, c] = [0, 1, 2].map((i) => t("premio_importe", { n: cifras[i] ?? 0 }));
    return t("premio_importes_linea", { n, a, b, c, en: escalon === nivel ? "si" : "no" });
  };
  return <section className="premio-importes">
    <h2 className="premio-importes-titulo">{t("premio_importes_titulo")}</h2>
    <p className="premio-importes-linea">{linea(basico, 1)}</p>
    <p className="premio-importes-linea">{linea(completo, 2)}</p>
  </section>;
}

function Marca({ cumple }: { cumple: boolean }) {
  return <span aria-hidden="true" className={`premio-check${cumple ? " cumple" : ""}`}>
    {cumple && <svg width={12} height={12} viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="m4 10 4 4 8-8" /></svg>}
  </span>;
}

function EdadFila({ cuenta }: { cuenta: PremioYo }) {
  const t = useTranslations();
  const texto = cuenta.edad === "mayor" ? "premio_edad_mayor"
    : cuenta.edad === "menor" ? "premio_edad_menor" : "premio_edad_sin";
  return <div className="premio-fila">
    <Marca cumple={cuenta.edad === "mayor"} />
    <div className="premio-fila-cuerpo">
      <b>{t("premio_edad")}</b>
      <small>{t(texto)}</small>
      {cuenta.edad === "sin_declarar" && <Link href="/completar" className="premio-declarar">
        {t("premio_edad_declarar")}
      </Link>}
    </div>
  </div>;
}

function EstrategiaFila({ cuenta, estrategias }: { cuenta: PremioYo; estrategias: Estrategia[] }) {
  const t = useTranslations();
  const designada = cuenta.estrategia?.id ?? null;
  const [elegida, setElegida] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function guardar() {
    if (elegida === null) return;
    setOcupada(true);
    const respuesta = await optarAlPremio(elegida);
    setOcupada(false);
    if (typeof respuesta === "string") {
      setAviso(respuesta);
      return;
    }
    setAviso(null);
    setElegida(null);
    invalidar("mis-estrategias", "premio-yo");
  }

  let cuerpo;
  if (estrategias.length === 0) {
    cuerpo = <>
      <small>{t("premio_estrategia_ninguna")}</small>
      <Link href="/crear" className="btn wide premio-crear">{t("premio_estrategia_crear")}</Link>
    </>;
  } else if (estrategias.length === 1) {
    cuerpo = <>
      <span className="premio-nombre">{estrategias[0].nombre}</span>
      <small>{t("premio_estrategia_unica")}</small>
    </>;
  } else {
    cuerpo = <>
      <div role="radiogroup" aria-label={t("premio_estrategia")}>
        {estrategias.map((e) => (
          <button key={e.id} type="button" role="radio" className="opt"
            aria-checked={(elegida ?? designada) === e.id} onClick={() => setElegida(e.id)}>
            <span className="dot" aria-hidden="true" />
            <b>{e.nombre}</b>
          </button>
        ))}
      </div>
      <small>{t("premio_estrategia_elegir")}</small>
      {aviso && <p className="aviso" role="alert">{aviso}</p>}
      <button type="button" className="btn pri wide premio-guardar"
        disabled={elegida === null || elegida === designada || ocupada}
        onClick={() => void guardar()}>{t("premio_estrategia_guardar")}</button>
    </>;
  }

  return <div className="premio-fila">
    <Marca cumple={designada !== null} />
    <div className="premio-fila-cuerpo">
      <b>{t("premio_estrategia")}</b>
      {cuerpo}
    </div>
  </div>;
}

function JornadasFila({ cuenta, temporada }: { cuenta: PremioYo; temporada: Temporada }) {
  const t = useTranslations();
  const n = temporada?.n_meses ?? 0;
  if (n === 0) return null;
  const jugadas = cuenta.jornadas_jugadas;
  const minimo = cuenta.minimo_jornadas;
  const cumple = jugadas >= minimo;
  return <div className="premio-fila">
    <Marca cumple={cumple} />
    <div className="premio-fila-cuerpo">
      <b>{t("premio_jornadas")}</b>
      <div className="premio-casillas" role="img"
        aria-label={t("premio_jornadas_aria", { j: jugadas, n })}>
        {Array.from({ length: n }, (_, i) => (
          <span key={i} aria-hidden="true"
            className={`premio-casilla${i < jugadas ? " jugada" : ""}`} />
        ))}
      </div>
      <small>{cumple ? t("premio_jornadas_cumple", { j: jugadas, n })
        : t("premio_jornadas_faltan", { j: jugadas, minimo, faltan: minimo - jugadas })}</small>
      <small>{t("premio_jornadas_nota")}</small>
    </div>
  </div>;
}

function ErrorPremio({ mensaje, reintentar }: { mensaje: string; reintentar: () => void }) {
  const t = useTranslations();
  return <ErrorLiga titulo={t("premio_titulo")} mensaje={mensaje}
    accion={{ texto: t("league_reintentar"), onClick: reintentar }} />;
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
  let contenido;
  if (!sesion) {
    contenido = <>
      <p className="meta">{t("premio_sesion")}</p>
      <Link href="/entrar?next=/premio" className="btn pri wide premio-entrar">
        {t("league_entrar")}
      </Link>
    </>;
  } else if (typeof propio === "string" || fallo) {
    contenido = <ErrorPremio
      mensaje={typeof propio === "string" ? propio : t("league_error_portada")}
      reintentar={refrescar} />;
  } else if (!cuenta || !estrategias) {
    contenido = <Cargando filas={3} />;
  } else {
    contenido = <div className="premio-tarjeta-cuenta">
      <EdadFila cuenta={cuenta} />
      <EstrategiaFila cuenta={cuenta} estrategias={estrategias} />
      <JornadasFila cuenta={cuenta} temporada={temporada} />
    </div>;
  }
  return <section className="premio-bloque">
    <div className="premio-cuenta-cab">
      <h2 className="sec-t">{t("premio_tu_cuenta")}</h2>
      {cuenta && <span className={`premio-pill${cuenta.optas ? " optas" : ""}`}>
        {t(cuenta.optas ? "premio_optas" : "premio_no_optas")}
      </span>}
    </div>
    {contenido}
  </section>;
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
  const temporada = typeof premio === "object" && premio ? premio.temporada ?? null : null;
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
      <TuCuenta temporada={temporada} sesion={Boolean(yo)} propio={propio} fallo={falloPropio}
        refrescar={refrescarPropio}
        estrategias={Array.isArray(estrategias) ? estrategias : undefined} />
      <Link href="/legal/bases-premio" className="btn wide premio-bases">
        {t("premio_leer_bases")}
      </Link>
    </>;
  }
  return <main className="scroll"><Cabecera />{contenido}<BarraPestanas /></main>;
}
