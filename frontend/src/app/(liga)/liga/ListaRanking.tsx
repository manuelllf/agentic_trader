"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { normalizeLocale, type Locale } from "@/i18n/locale";
import { porcentaje, signo } from "@/lib/liga/format";
import { Escudo, type EscudoValor } from "../_ui/Escudo";
import type { ClaveCasa } from "../_ui/casa";
import "./ranking.css";

// Lista de la maqueta v12: filas a sangre con escudo, nombre, gráfica pequeña y una píldora que
// cambia de dato al tocarla. El dato lo cambia la lista entera, no una sola fila.
export type ModoRanking = "vs" | "rent" | "pts";

export interface FilaRanking {
  clave: string;
  puesto: number;
  /** Puestos subidos (positivo) o bajados (negativo) desde el corte anterior. */
  movimiento?: number | null;
  nombre: string;
  sub: string;
  escudo: EscudoValor;
  casa?: ClaveCasa | null;
  /** Rentabilidad acumulada en cada paso, desde 0; la gráfica acaba en la cifra de la fila. */
  serie: number[];
  /** Diferencia con el S&P en puntos porcentuales; `null` si aún no hay cifra. */
  vs: number | null;
  rentabilidad: number | null;
  puntos: number | null;
  tuya?: boolean;
  onAbrir: () => void;
  alAcercar?: () => void;
}

/** Una fila, o un hueco («y 103 más») entre filas. */
export type EntradaRanking = FilaRanking | { hueco: string };

type Traduce = (clave: string, valores?: Record<string, number | string>) => string;

/** Empate de la liga: a ±0,2 pp del S&P se gana o se pierde por poco y se suma 1 punto (motor/puntos.py). */
const BANDA_EMPATE = 0.2;

/** Color por resultado, no por signo: verde si gana, rojo si pierde y neutro dentro de la banda. */
function claseDe(vs: number | null): "bien" | "mal" | "" {
  if (vs == null) return "";
  return vs > BANDA_EMPATE ? "bien" : vs < -BANDA_EMPATE ? "mal" : "";
}

function cifraDe(fila: FilaRanking, modo: ModoRanking, locale: Locale, t: Traduce): { texto: string; clase: string } {
  const clase = claseDe(fila.vs);
  if (modo === "pts" && fila.puntos != null) return { texto: t("strategies_points", { count: fila.puntos }), clase: "" };
  if (modo === "vs") return { texto: fila.vs == null ? "-" : signo(fila.vs, 1, locale), clase };
  return { texto: fila.rentabilidad == null ? "-" : porcentaje(fila.rentabilidad, 1, locale), clase };
}

function GraficaSerie({ valores, vs }: { valores: number[]; vs: number | null }) {
  const serie = valores.map(Number);
  if (serie.length < 2) return <span className="lv-grafica" aria-hidden="true" />;
  const ancho = 58, alto = 28;
  const min = Math.min(0, ...serie), max = Math.max(0, ...serie);
  const rango = max - min || 1;
  const x = (i: number) => (i * ancho) / (serie.length - 1);
  const y = (v: number) => alto - ((v - min) / rango) * alto;
  const puntos = serie.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const color = vs == null || Math.abs(vs) <= BANDA_EMPATE ? "var(--muted)" : vs > 0 ? "var(--good)" : "var(--bad)";
  return (
    <svg className="lv-grafica" viewBox={`0 0 ${ancho} ${alto}`} aria-hidden="true">
      <line x1={0} x2={ancho} y1={y(0)} y2={y(0)} strokeDasharray="2 3" style={{ stroke: "var(--line2)" }} />
      <polyline points={puntos} fill="none" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round"
        style={{ stroke: color }} />
    </svg>
  );
}

function FilaRankingItem({ fila, modo, onCiclar }: { fila: FilaRanking; modo: ModoRanking; onCiclar: () => void }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const { texto, clase } = cifraDe(fila, modo, locale, (clave, valores) => t(clave, valores));
  const movimiento = fila.movimiento ?? 0;
  return (
    <li className={`lv-fila${fila.tuya ? " tuya" : ""}`}>
      <button type="button" className="lv-fila-abre" onClick={fila.onAbrir}
        onPointerEnter={fila.alAcercar} onFocus={fila.alAcercar}>
        <span className="lv-pos num">
          {fila.puesto}
          {movimiento !== 0 && (
            <small className={movimiento > 0 ? "lv-sube" : "lv-baja"}
              aria-label={t(movimiento > 0 ? "common_ranking_sube_posiciones" : "common_ranking_baja_posiciones",
                { count: Math.abs(movimiento) })}>
              {movimiento > 0 ? "▲" : "▼"}{Math.abs(movimiento)}
            </small>
          )}
        </span>
        <Escudo valor={fila.escudo} casa={fila.casa} baldosa tamano={32}
          etiqueta={t("common_ranking_escudo", { name: fila.nombre })} />
        <span className="lv-nombre"><b>{fila.nombre}</b>{fila.sub && <small>{fila.sub}</small>}</span>
        <GraficaSerie valores={fila.serie} vs={fila.vs} />
      </button>
      <button type="button" className={`lv-pildora${clase ? ` ${clase}` : ""}`} onClick={onCiclar}
        aria-label={`${texto}, ${t("league_cambiar_dato")}`}>
        {texto}
      </button>
    </li>
  );
}

/** Esqueleto con la forma de la fila: puesto, baldosa, una línea de nombre, gráfica y píldora. */
export function EsqueletoRanking({ filas = 5 }: { filas?: number }) {
  const t = useTranslations();
  return (
    <div className="lv-esqueleto" role="status" aria-live="polite">
      <span className="sr-only">{t("common_cargando")}</span>
      <ul className="lv-lista" aria-hidden="true">
        {Array.from({ length: filas }, (_, i) => (
          <li key={i} className="lv-fila">
            <span className="lv-fila-abre">
              <span />
              <span className="esqueleto-bloque" style={{ width: 32, height: 32, borderRadius: 9 }} />
              <span className="esqueleto-bloque" style={{ width: `${62 - (i % 3) * 12}%`, height: 14 }} />
              <span />
            </span>
            <span className="esqueleto-bloque" style={{ justifySelf: "end", width: 70, height: 32, borderRadius: 8 }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ListaRanking({
  cabecera, modos, etiquetas, entradas,
}: {
  cabecera: ReactNode;
  modos: ModoRanking[];
  etiquetas: Record<ModoRanking, string>;
  entradas: EntradaRanking[];
}) {
  const [indice, setIndice] = useState(0);
  const modo = modos[indice];
  const ciclar = () => setIndice((i) => (i + 1) % modos.length);
  return (
    <>
      <p className="lv-lista-cab"><span>{cabecera}</span><span><b>{etiquetas[modo]}</b></span></p>
      <ul className="lv-lista">
        {entradas.map((entrada, i) => ("hueco" in entrada
          ? <li key={`hueco-${i}`} className="lv-hueco">{entrada.hueco}</li>
          : <FilaRankingItem key={entrada.clave} fila={entrada} modo={modo} onCiclar={ciclar} />))}
      </ul>
    </>
  );
}
