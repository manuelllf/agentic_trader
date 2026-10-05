"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { localeTag, normalizeLocale } from "@/i18n/locale";
import {
  excluirEmpresa, miVentana, quitarExclusion, volverALaFormacion,
  type EmpresaVentana, type Ventana,
} from "@/lib/liga/api";
import { fijar } from "@/lib/liga/cache";
import { fecha } from "@/lib/liga/format";
import { Boton } from "./Boton";

const MINUTO = 60_000;

/** Una lectura del reloj cada medio minuto: la cuenta atrás no necesita más. */
function useAhora(): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), MINUTO / 2);
    return () => clearInterval(id);
  }, []);
  return ahora;
}

/** Hasta cuándo se puede cambiar, en hora de España como el resto de la liga. */
export function cierreDeCambios(iso: string, locale: "es" | "en") {
  const t = new Date(iso);
  return {
    dia: fecha(t, new Date(), locale),
    hora: t.toLocaleTimeString(localeTag(locale), { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }),
  };
}

/** Cartera ya formada de una estrategia: del corte hasta que abre la jornada solo se puede cambiar y
 *  recuperar empresas. Cada cambio recalcula la cartera en el servidor, sin IA. */
export function VentanaCambios({ ventana, nombre, alCerrarse }: {
  ventana: Ventana;
  nombre: string;
  alCerrarse: () => void;
}) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const ahora = useAhora();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { dia, hora } = cierreDeCambios(ventana.cierra, locale);
  const minutos = Math.max(0, Math.floor((new Date(ventana.cierra).getTime() - ahora) / MINUTO));
  const cerrada = minutos === 0;
  useEffect(() => { if (cerrada) alCerrarse(); }, [cerrada, alCerrarse]);

  const quedan = minutos >= 60
    ? t("window_left_hm", { hours: Math.floor(minutos / 60), minutes: minutos % 60 })
    : t("window_left_m", { minutes: minutos });
  const nombreDe = (e: { ticker: string; nombre: string | null }) => e.nombre ?? e.ticker;

  const actuales = ventana.quitadas.map((q) => q.ticker);
  const distintasDeLaFormacion = actuales.length !== ventana.quitadas_formacion.length
    || actuales.some((q) => !ventana.quitadas_formacion.includes(q));

  /** Lanza el cambio y deja la caché con la ventana nueva; devuelve la ventana o el error. */
  async function aplicar(clave: string, accion: () => Promise<unknown>): Promise<Ventana | null> {
    setOcupado(clave);
    setError(null);
    setMensaje(null);
    const r = await accion();
    if (typeof r === "string") { setError(r); setOcupado(null); return null; }
    const lista = await miVentana();
    setOcupado(null);
    if (typeof lista === "string") { setError(lista); return null; }
    fijar("ventana", lista);
    return lista.find((v) => v.estrategia_id === ventana.estrategia_id) ?? null;
  }

  async function cambiar(emp: EmpresaVentana) {
    const antes = new Set(ventana.cartera.map((e) => e.ticker));
    const nueva = await aplicar(emp.ticker, () => excluirEmpresa(ventana.estrategia_id, emp.ticker));
    if (!nueva) return;
    const entra = nueva.cartera.find((e) => !antes.has(e.ticker));
    setMensaje(entra
      ? t("window_swapped", { out: nombreDe(emp), in: nombreDe(entra) })
      : t("window_removed_no_alternative", { name: nombreDe(emp) }));
  }

  async function recuperar(q: { ticker: string; nombre: string | null }) {
    const nueva = await aplicar(q.ticker, () => quitarExclusion(ventana.estrategia_id, q.ticker));
    if (nueva) setMensaje(t("window_recovered", { name: nombreDe(q) }));
  }

  async function volver() {
    const nueva = await aplicar("volver", () => volverALaFormacion(ventana.estrategia_id));
    if (nueva) setMensaje(t("window_back_done"));
  }

  if (ventana.fase === "formando") {
    return (
      <section className="sec" aria-label={t("window_title", { name: nombre })}>
        <h2 className="sec-t">{t("window_forming_title")}</h2>
        <p className="callout" role="status" style={{ marginTop: 0 }}>{t("window_forming_text", { date: dia, time: hora })}</p>
      </section>
    );
  }

  return (
    <section className="sec" aria-label={t("window_title", { name: nombre })}>
      <h2 className="sec-t">{t("window_title", { name: nombre })}</h2>
      <p className="callout" style={{ marginTop: 0 }}>
        <b>{quedan}.</b> {t("window_open_text", { date: dia, time: hora })}
      </p>
      <p className="meta" role="status" aria-live="polite">{mensaje ?? " "}</p>
      {error && <p className="aviso" role="alert">{error}</p>}

      <div>
        {ventana.cartera.map((e) => (
          <div className="pick" key={e.ticker} aria-busy={ocupado === e.ticker || undefined}>
            <div>
              <b>{nombreDe(e)}</b>
              <span>{e.ticker} · {e.sector ?? t("builder_no_sector")}</span>
            </div>
            <div className="pick-r">
              <span className="num">{Math.round(Number(e.peso))}&nbsp;%</span>
              <button type="button" disabled={ocupado !== null} onClick={() => void cambiar(e)}
                      aria-label={t("window_change_aria", { name: nombreDe(e) })}>
                {t("builder_change_company")}
              </button>
            </div>
          </div>
        ))}
      </div>

      {ventana.quitadas.length > 0 && (
        <div className="sec" style={{ marginTop: 26 }}>
          <h3 className="sec-t">{t("window_removed_title", { count: ventana.quitadas.length })}</h3>
          <p className="meta">{t("window_removed_text")}</p>
          {ventana.quitadas.map((q) => (
            <div className="pick" key={q.ticker} aria-busy={ocupado === q.ticker || undefined}>
              <div>
                <b>{nombreDe(q)}</b>
                <span>{q.ticker}</span>
              </div>
              <div className="pick-r">
                <button type="button" disabled={ocupado !== null} onClick={() => void recuperar(q)}
                        aria-label={t("window_recover_aria", { name: nombreDe(q) })}>
                  {t("window_recover")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {distintasDeLaFormacion && (
        <Boton variante="secundario" ancho="completo" style={{ marginTop: 18 }}
               disabled={ocupado !== null} onClick={() => void volver()}>
          {t("window_back_to_formation")}
        </Boton>
      )}
    </section>
  );
}
