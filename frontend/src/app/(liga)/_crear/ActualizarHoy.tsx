"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { actualizarDatos, getActualizacion, type ActualizacionDatos, type RecetaEntrada } from "@/lib/liga/api";

export function ActualizarHoy({ receta, alActualizar }: { receta: RecetaEntrada; alActualizar: () => void }) {
  const t = useTranslations(), locale = useLocale();
  const [dato, setDato] = useState<ActualizacionDatos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [consulta, setConsulta] = useState(0);
  const [ahora, setAhora] = useState(() => Date.now());
  const notificada = useRef<string | null>(null);
  const callback = useRef(alActualizar);
  callback.current = alActualizar;

  useEffect(() => {
    let activo = true;
    let timer: ReturnType<typeof setTimeout>;
    async function consultar() {
      try {
        const r = await getActualizacion();
        if (!activo) return;
        if (typeof r === "string") { setError(true); return; }
        setDato(r);
        if (r?.estado === "fallida") setError(true);
        if (r?.estado === "hecha" && new Date(r.creada).toLocaleDateString(locale) === new Date().toLocaleDateString(locale)
          && notificada.current !== r.creada) {
          notificada.current = r.creada;
          callback.current();
        }
        if (r?.estado === "en_curso") timer = setTimeout(() => void consultar(), 2000);
      } catch { if (activo) setError(true); }
      finally { if (activo) setCargando(false); }
    }
    void consultar();
    return () => { activo = false; clearTimeout(timer); };
  }, [consulta, locale]);

  useEffect(() => {
    const restante = Date.parse(dato?.puede_repetir_el ?? "") - Date.now();
    if (!(restante > 0)) return;
    const timer = setTimeout(() => setAhora(Date.now()), restante);
    return () => clearTimeout(timer);
  }, [dato?.puede_repetir_el]);

  async function actualizar() {
    setCargando(true);
    setError(false);
    try {
      const r = await actualizarDatos(receta);
      if (typeof r === "string") { setError(true); setConsulta(n => n + 1); return; }
      setDato({ estado: "en_curso", hechas: 0, total: r.total,
        creada: new Date().toISOString(), puede_repetir_el: "" });
      setConsulta(n => n + 1);
    } catch { setError(true); }
    finally { setCargando(false); }
  }

  const corriendo = dato?.estado === "en_curso";
  const bloqueada = !!dato?.puede_repetir_el && Date.parse(dato.puede_repetir_el) > ahora;
  const fresca = dato?.estado === "hecha" && new Date(dato.creada).toLocaleDateString(locale) === new Date().toLocaleDateString(locale);
  return <section className="actualizar-hoy field" aria-label={t("builder_actualizar_titulo")}>
    <div className="actualizar-hoy-fila">
      <div><h3 className="lbl">{t("builder_actualizar_titulo")}</h3>
        <p className="fine">{t(fresca ? "builder_actualizar_hecha" : "builder_actualizar_ayuda")}</p>
        {bloqueada && <p className="fine">{t("builder_actualizar_proxima", {
          fecha: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(dato!.puede_repetir_el)),
        })}</p>}
      </div>
      <button type="button" className="btn small" disabled={cargando || corriendo || bloqueada}
        onClick={() => void actualizar()}>{t("builder_actualizar_boton")}</button>
    </div>
    <div role="status" aria-live="polite">
      {corriendo && <><p className="num">{t("builder_actualizar_progreso", { count: dato.hechas })}</p>
        <progress max={300} value={dato.hechas} aria-label={t("builder_actualizar_titulo")} /></>}
      {error && <p className="fine">{t("builder_actualizar_fallida")}</p>}
    </div>
  </section>;
}
