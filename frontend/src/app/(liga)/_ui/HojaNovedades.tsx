"use client";

import { useEffect, useId, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import type { Novedades } from "@/lib/liga/api";
import { claseSigno, fecha, porcentaje } from "@/lib/liga/format";
import { Boton } from "./Boton";
import { Chip } from "./Chip";

export function HojaNovedades({ novedades, alCerrar }: { novedades: Novedades; alCerrar: () => void }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const titulo = useId();
  const atras = useRef<HTMLButtonElement>(null);
  const entendido = useRef<HTMLDivElement>(null);
  const dia = (valor: string) => fecha(valor, undefined, locale);
  const cifra = (valor: number) => porcentaje(valor, 1, locale);
  const conDatos = novedades.estrategias.some((e) => e.semana?.rentabilidad != null
    || e.movidas.some((m) => m.aportacion != null) || e.desde_lunes?.rentabilidad != null || e.cambios.length > 0);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    atras.current?.focus();
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") alCerrar();
      if (e.key === "Tab") {
        if (e.shiftKey && document.activeElement === atras.current) {
          e.preventDefault(); entendido.current?.querySelector("button")?.focus();
        } else if (!e.shiftKey && document.activeElement === entendido.current?.querySelector("button")) {
          e.preventDefault(); atras.current?.focus();
        }
      }
    }
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("keydown", tecla);
      document.body.style.overflow = overflow;
      anterior?.focus();
    };
  }, [alCerrar]);

  return <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titulo}>
    <header className="sheet-h" style={{ flexShrink: 0 }}>
      <button ref={atras} type="button" className="back" onClick={alCerrar}>{t("novedades_atras")}</button>
      <span className="meta">{t("novedades_desde", { fecha: dia(novedades.desde) })}</span>
    </header>
    <div className="sheet-b" style={{ minHeight: 0 }}>
      <div style={{ maxWidth: "var(--ancho-lectura, 720px)", margin: "0 auto", overflowWrap: "anywhere" }}>
        <h1 id={titulo} style={conDatos ? { fontSize: 24 } : undefined} className={conDatos ? undefined : "sr-only"}>{t("novedades_titulo")}</h1>
        {conDatos && <>
          <p className="meta">{t("novedades_entradilla")}</p>
          {novedades.estrategias.map((e) => <section key={e.estrategia_id} style={{ marginTop: 28 }}>
            {novedades.estrategias.length > 1 && <h2 style={{ fontSize: 22 }}>{e.nombre}</h2>}
            {e.semana?.rentabilidad != null && <section style={{ marginTop: 28 }}>
              <h3>{t("novedades_semana")}</h3>
              <div className={`num ${claseSigno(e.semana.rentabilidad)}`} style={{ fontSize: 36, fontWeight: "var(--w-num)" }}>{cifra(e.semana.rentabilidad)}</div>
              {e.semana.sp500 != null && <p className="meta">{t("novedades_sp", { sp: cifra(e.semana.sp500) })}</p>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {e.semana.puntos != null && <Chip>{t("novedades_puntos", { n: e.semana.puntos })}</Chip>}
                {e.semana.puesto != null && e.semana.de != null && <Chip>
                  {t("novedades_puesto", { puesto: e.semana.puesto, de: e.semana.de })}
                  {t("novedades_movimiento", { movimiento: e.semana.movimiento
                    ? t(e.semana.movimiento > 0 ? "novedades_sube" : "novedades_baja", { n: Math.abs(e.semana.movimiento) })
                    : t("novedades_igual") })}
                </Chip>}
              </div>
              <p className="meta">{t("novedades_rango", { inicio: dia(e.semana.dia_inicio), fin: dia(e.semana.dia_fin) })}</p>
            </section>}
            {e.movidas.some((m) => m.aportacion != null) && <section style={{ marginTop: 28 }}>
              <h3>{t("novedades_movidas")}</h3>
              <ul style={{ listStyle: "none", padding: 0 }}>
                {e.movidas.filter((m) => m.aportacion != null).slice(0, 5).map((m) => <li key={m.ticker}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 60, borderBottom: "1px solid var(--line)" }}>
                  <div style={{ minWidth: 0 }}><strong>{m.nombre}</strong><div className="meta">{m.ticker}</div></div>
                  <span className={`num ${claseSigno(m.aportacion!)}`} style={{ flexShrink: 0 }}>{cifra(m.aportacion!)}</span>
                </li>)}
              </ul>
            </section>}
            {e.desde_lunes?.rentabilidad != null && <section style={{ marginTop: 28 }}>
              <h3>{t("novedades_desde_lunes")}</h3>
              <div className={`num ${claseSigno(e.desde_lunes.rentabilidad)}`} style={{ fontSize: 26, fontWeight: "var(--w-num)" }}>{cifra(e.desde_lunes.rentabilidad)}</div>
              <p className="meta">{t("novedades_desde_lunes_nota")}</p>
            </section>}
            {e.cambios.length > 0 && <section style={{ marginTop: 28 }}>
              <h3>{t("novedades_cambios")}</h3>
              {e.cambios.map((c, i) => <p key={`${c.accion}:${c.ticker}:${c.fecha}:${i}`}>
                {t(`novedades_${c.accion === "quitar" && c.entra != null ? "cambio_por" : c.accion}${c.cuenta_desde === null ? "_sin_desde" : ""}`, {
                  fecha: dia(c.fecha), ...(c.accion === "quitar" && c.entra != null
                    ? { salida: c.ticker ?? "", entrada: c.entra }
                    : c.accion === "volver" ? {} : { ticker: c.ticker ?? "" }),
                  ...(c.cuenta_desde === null ? {} : { desde: dia(c.cuenta_desde) }),
                })}
              </p>)}
            </section>}
          </section>)}
        </>}
      </div>
    </div>
    <footer className="sheet-f" style={{ flexDirection: "column", flexShrink: 0 }}>
      <div ref={entendido} style={{ width: "100%", maxWidth: "var(--ancho-lectura, 720px)", margin: "0 auto" }}>
        <Boton variante="principal" ancho="completo" onClick={alCerrar}>{t("novedades_cerrar")}</Boton>
        {conDatos && <p className="meta" style={{ textAlign: "center", marginBottom: 0 }}>{t("novedades_una_vez")}</p>}
      </div>
    </footer>
  </div>;
}
