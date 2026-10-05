"use client";
import { useLocale, useTranslations } from "next-intl";
import { localeTag } from "@/i18n/locale";
import type { CSSProperties } from "react";
import { Escudo } from "../_ui";
import { signo } from "@/lib/liga/format";
import { SP, puntos, puntosTotales, tablaDe, type Idea } from "./ideas";

// Todo el movimiento es CSS con retardos (`--d`): sin temporizadores, y con «reducir movimiento»
// se ve directamente el estado final. Un `key` distinto en el padre la vuelve a jugar.
const retraso = (segundos: number) => ({ ["--d" as string]: `${segundos}s` }) as CSSProperties;


export function Escena({ idea }: { idea: Idea }) {
  const t = useTranslations();
  const locale = useLocale() === "en" ? "en" : "es";
  const month = (index: number, length: "short" | "long") => new Intl.DateTimeFormat(
    localeTag(locale), { month: length, timeZone: "UTC" },
  ).format(new Date(Date.UTC(2020, index + 3, 1)));
  const MESES = Array.from({ length: 6 }, (_, index) => month(index, "short"));
  const total = puntosTotales(idea);
  const tabla = tablaDe(idea).map((row) => ({ ...row,
    nombre: row.mia ? t("landing_tu_estrategia") : row.nombre === "Foso ancho" ? t("landing_foso_ancho")
      : row.nombre === "Deuda cero" ? t("landing_deuda_cero") : row.nombre,
    sub: row.mia ? t("landing_tu") : row.sub === "casa" ? t("landing_casa") : row.sub,
  }));
  const puesto = tabla.findIndex((f) => f.mia) + 1;
  const acumulado = (retornos: number[]) => (retornos.reduce((capital, r) => capital * (1 + r / 100), 1) - 1) * 100;

  return (
    <div className="lnd-esc">
      <section className="lnd-b" aria-label={t("landing_tu_idea")}>
        <p className="lnd-frase">
          {idea.frases.map((f, i) => (
            <span key={f} className="lnd-chip" style={retraso(0.15 + i * 0.4)}>{f}</span>
          ))}
        </p>
        <div className="lnd-escudo lnd-pop" style={retraso(1.3)}>
          <Escudo valor={idea.escudo} etiqueta={t("landing_escudo", { nombre: idea.nombre })} tamano={64} />
          <b>{idea.nombre}</b>
        </div>
      </section>

      <section className="lnd-b" aria-label={t("landing_sus_empresas")}>
        <h2 className="lnd-lab">
          <span className="lnd-lab-a">{t("landing_motor_elige")}</span>
          <span className="lnd-lab-b">{t("landing_cinco_empresas")}</span>
        </h2>
        <ul className="lnd-emp">
          {idea.empresas.map((e, i) => (
            <li key={e.nombre} className="lnd-a" style={retraso(1.9 + i * 0.45)}>
              <span className="lnd-emp-n">{e.nombre}</span>
              <span className="lnd-emp-p" style={retraso(2.05 + i * 0.45)}>{e.porque}</span>
              <b className="lnd-emp-w">{e.peso} %</b>
            </li>
          ))}
        </ul>
      </section>

      <section className="lnd-b lnd-mes-b" aria-label={t("landing_comportamiento")}>
        <h2 className="lnd-lab">
          {t("landing_seis_meses")} <span className="lnd-ej">{t("landing_ejemplo")}</span>
        </h2>
        <ol className="lnd-meses">
          {MESES.map((m, j) => {
            const p = puntos(idea.tu[j], SP[j]);
            return (
              <li key={m} className={`lnd-mes r${p}`} style={{ ["--j" as string]: j } as CSSProperties}>
                <span className="lnd-mes-m" aria-hidden="true">{m}</span>
                <b className="lnd-mes-d" aria-hidden="true">{signo(idea.tu[j] - SP[j], 1, locale)}</b>
                <i className="lnd-mes-p" aria-hidden="true">{p}</i>
                <span className="sr-only">
                  {t("landing_mes_resultado", { mes: month(j, "long"), tu: signo(idea.tu[j], 1, locale), sp: signo(SP[j], 1, locale), count: p })}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="lnd-nota lnd-tarde-1">{t("landing_diferencia_mensual")}</p>
        <p className="lnd-conclusion lnd-tarde-1">{idea.conclusion}</p>

        <p className="lnd-nota lnd-tarde-1">
          {t.rich("landing_acumulado_ejemplo", { tu: signo(acumulado(idea.tu), 1, locale), sp: signo(acumulado(SP), 1, locale), b: chunks => <b>{chunks}</b> })}
        </p>

        <p className="lnd-puesto lnd-tarde-2">
          {t.rich("landing_puesto_ejemplo", { count: total, puesto, b: chunks => <b>{chunks}</b> })}
        </p>
        <ol className="lnd-tabla lnd-tarde-2" aria-label={t("landing_clasificacion_ejemplo")}>
          {tabla.map((f, i) => (
            <li key={f.nombre} className={f.mia ? "mia" : undefined}>
              <span className="lnd-t-pos">{i + 1}</span>
              <Escudo valor={f.escudo} etiqueta={t("landing_escudo", { nombre: f.nombre })} tamano={24} />
              <span className="lnd-t-n">{f.nombre} <em>{f.sub}</em></span>
              <b className="lnd-t-pts">{f.puntos}</b>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
