import { useEffect, useRef, useState } from "react";
import * as api from "@/lib/criptico/api";
import { ApiError } from "@/lib/api";
import { cargarPartida } from "@/lib/criptico/partida";
import type { Acertijo, Idioma, Traducir } from "@/lib/criptico/tipos";
import { ruta } from "./textos";

export default function Archivo({ idioma, actual, ultimo, t, revision }: {
  idioma: Idioma; actual: number; ultimo: number; t: Traducir; revision: string;
}) {
  const [limite, setLimite] = useState(5);
  const [dias, setDias] = useState<Acertijo[]>([]);
  const [error, setError] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [intento, setIntento] = useState(0);
  const cache = useRef(new Map<number, Acertijo | null>());
  useEffect(() => {
    let activo = true;
    setCargando(true); setError(false);
    const numeros = Array.from({ length: Math.min(limite, Math.max(0, ultimo - 1)) }, (_, i) => ultimo - i - 1);
    void Promise.all(numeros.map(async n => {
      if (cache.current.has(n)) return cache.current.get(n) ?? null;
      try {
        const { acertijo } = await api.numero(n, idioma);
        cache.current.set(n, acertijo); return acertijo;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) { cache.current.set(n, null); return null; }
        if (activo) setError(true);
        return null;
      }
    })).then(resultados => {
      if (activo) { setDias(resultados.filter((a): a is Acertijo => a !== null)); setCargando(false); }
    });
    return () => { activo = false; };
  }, [idioma, ultimo, limite, intento]);
  const fecha = (a: Acertijo, opciones: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(idioma,
    { ...opciones, timeZone: "Europe/Madrid" }).format(new Date(`${a.fecha.slice(0, 10)}T12:00:00Z`));
  const hecho = (a: Acertijo) => cargarPartida(a).resultado !== "jugando";
  return <div className="cr-archivo" data-revision={revision}>
    <nav className="cr-dias" aria-label={t("cr_archivo")}>
      {dias.slice(0, 4).reverse().map(a => <a key={a.numero} href={`${ruta(idioma)}/${a.numero}`}
        aria-current={actual === a.numero ? "page" : undefined} className={`cr-dia${hecho(a) ? " hecho" : ""}`} aria-label={`${fecha(a, { dateStyle: "long" })}: ${t(hecho(a) ? "cr_hecho" : "cr_pendiente")}`}>
        <span>{fecha(a, { weekday: "short" })}</span><b>{fecha(a, { day: "numeric" })}</b><i aria-hidden="true" />
      </a>)}
      <a className="cr-dia" href={ruta(idioma)} aria-current={actual === ultimo ? "page" : undefined}><span>{t("cr_hoy")}</span><b>{t("cr_numero", { n: ultimo })}</b><i aria-hidden="true" /></a>
    </nav>
    <details><summary>{t("cr_archivo")}</summary>
      <ul className="cr-lista-archivo">{dias.map(a => <li key={a.numero}><a href={`${ruta(idioma)}/${a.numero}`} aria-current={actual === a.numero ? "page" : undefined}>
        <span>{t("cr_numero", { n: a.numero })} · {fecha(a, { day: "numeric", month: "long" })}</span>
        <span>{t(hecho(a) ? "cr_hecho" : "cr_pendiente")}</span></a></li>)}</ul>
      {cargando && <p role="status">{t("cr_cargando")}</p>}
      {error && <div role="status"><p>{t("cr_error")}</p><button type="button" className="cr-enlace" onClick={() => setIntento(n => n + 1)}>{t("cr_reintentar")}</button></div>}
      {limite < ultimo - 1 && <button type="button" className="cr-enlace" disabled={cargando} onClick={() => setLimite(n => n + 7)}>{t("cr_mas")}</button>}
    </details>
  </div>;
}
