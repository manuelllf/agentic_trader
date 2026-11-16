"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { get } from "@/lib/api";
import { getCatalogo } from "@/lib/liga/api";
import { tokenSesion } from "@/lib/liga/supabase";
import { fechaCorta } from "../../_marco/formato";
import { Celda, Grupo, Hoja, Vacio } from "../../_panel/ui";
import "../usuarios/pp.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const CLAVES = ["sin_estrategia", "inactivas", "nunca_apuntadas", "reglas_usadas"] as const;
type Clave = (typeof CLAVES)[number];
type ConsultaOut = { clave: string; columnas: string[]; filas: unknown[][]; umbral_dias: number | null };
type Resultado = { estado: "cargando" } | { estado: "error" } | { estado: "ok"; datos: ConsultaOut };
const ESTADOS_ESTRATEGIA: Record<string, string> = { borrador: "strategies_state_draft", apuntada: "strategies_state_signed_up", jugando: "strategies_state_playing", retirada: "strategies_state_retired" };
const MAXIMO_FILAS = 200;

function Consultas() {
  const t = useTranslations();
  const locale = useLocale();
  const [reglas, setReglas] = useState<Record<string, string>>({});
  const [resultados, setResultados] = useState<Partial<Record<Clave, Resultado>>>({});
  const [abierta, setAbierta] = useState<Clave | null>(null);
  const [exportando, setExportando] = useState(false);
  const [falloCsv, setFalloCsv] = useState(false);

  useEffect(() => {
    let vigente = true;
    void getCatalogo().then(c => { if (vigente && typeof c !== "string") setReglas(Object.fromEntries(c.reglas.map(r => [r.clave, r.titulo]))); }).catch(() => {});
    return () => { vigente = false; };
  }, []);

  const cargar = useCallback((clave: Clave) => {
    setResultados(r => ({ ...r, [clave]: { estado: "cargando" } }));
    get<ConsultaOut>(`/liga/admin/panel/consultas/${clave}`)
      .then(datos => setResultados(r => ({ ...r, [clave]: { estado: "ok", datos } })))
      .catch(() => setResultados(r => ({ ...r, [clave]: { estado: "error" } })));
  }, []);
  useEffect(() => { CLAVES.forEach(cargar); }, [cargar]);

  const exportar = async (clave: Clave) => {
    setExportando(true); setFalloCsv(false);
    try {
      const sesion = await tokenSesion();
      const token = sesion?.aal === "aal2" ? sesion.token : null;
      const r = await fetch(`${API_URL}/liga/admin/panel/consultas/${clave}?formato=csv`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!r.ok) throw new Error();
      const nombre = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? `${clave}.csv`;
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { setFalloCsv(true); } finally { setExportando(false); }
  };

  const ayudaDe = (clave: Clave, datos: ConsultaOut) => (clave === "sin_estrategia" || clave === "inactivas")
    ? datos.umbral_dias == null ? null : t(`pnl_personas_cons_${clave}_ayuda`, { dias: datos.umbral_dias })
    : t(`pnl_personas_cons_${clave}_ayuda`);

  const celda = (valor: unknown, columna: string, clave: Clave): string => {
    if (columna === "clave" && clave === "reglas_usadas" && typeof valor === "string") return reglas[valor] ?? valor;
    if (columna === "estado" && typeof valor === "string" && valor in ESTADOS_ESTRATEGIA) return t(ESTADOS_ESTRATEGIA[valor]);
    if (valor == null) return t("pnl_personas_sin_dato");
    if (typeof valor === "boolean") return t(valor ? "pnl_personas_si" : "pnl_personas_no");
    if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}/.test(valor) && !Number.isNaN(new Date(valor).getTime())) return fechaCorta(valor, locale);
    return String(valor);
  };

  const hoja = abierta ? resultados[abierta] : undefined;
  const datos = hoja?.estado === "ok" ? hoja.datos : null;
  // La primera columna que es toda numérica va a la derecha de la fila; el resto, como líneas con su nombre.
  const numerica = datos ? datos.columnas.findIndex((_, i) => {
    const v = datos.filas.map(f => f[i]).filter(x => x != null);
    return i > 0 && v.length > 0 && v.every(x => typeof x === "number");
  }) : -1;

  return (
    <div className="pnl-llega pp">
      <Grupo cabecera={t("pnl_personas_cons_cab")} pie={t("pnl_personas_cons_pie")}>
        {CLAVES.map(clave => {
          const r = resultados[clave];
          const ok = r?.estado === "ok" ? r.datos : null;
          return (
            <Celda key={clave} titulo={t(`pnl_personas_cons_${clave}`)}
              subtitulo={r?.estado === "error" ? t("admin_generic_error") : ok ? ayudaDe(clave, ok) ?? undefined : undefined}
              valor={ok ? ok.filas.length : undefined}
              deshabilitada={!r || r.estado === "cargando"}
              onClick={() => { if (r?.estado === "error") cargar(clave); else setAbierta(clave); }} />
          );
        })}
      </Grupo>

      {abierta && datos && (
        <Hoja abierta titulo={t(`pnl_personas_cons_${abierta}`)} accion={t("admin_pnl_listo")} onCerrar={() => { setAbierta(null); setFalloCsv(false); }}>
          <div className="pp-hoja">
            <p className="pp-cifra"><small>{ayudaDe(abierta, datos)}</small><b>{datos.filas.length}</b></p>
            {datos.filas.length === 0 ? (
              <Vacio titulo={t("pnl_personas_cons_vacia")} />
            ) : (
              <Grupo pie={datos.filas.length > MAXIMO_FILAS ? t("pnl_personas_cons_se_ven", { shown: MAXIMO_FILAS, total: datos.filas.length }) : undefined}>
                {datos.filas.slice(0, MAXIMO_FILAS).map((fila, i) => (
                  <Celda key={i} titulo={celda(fila[0], datos.columnas[0], abierta)}
                    valor={numerica > 0 ? celda(fila[numerica], datos.columnas[numerica], abierta) : undefined}
                    subtitulo={datos.columnas.length > 1 + (numerica > 0 ? 1 : 0) ? (
                      <span className="pp-sub">{datos.columnas.map((c, j) => j === 0 || j === numerica ? null : (
                        <span key={c}>{t(`pnl_personas_col_${c}`)}: {celda(fila[j], c, abierta)}</span>
                      ))}</span>
                    ) : undefined} />
                ))}
              </Grupo>
            )}
            {falloCsv && <p className="pp-aviso" role="alert">{t("admin_generic_error")}</p>}
            <button type="button" className="pp-boton" disabled={exportando} onClick={() => void exportar(abierta)}>{t("pnl_personas_cons_csv")}</button>
          </div>
        </Hoja>
      )}
    </div>
  );
}

export default function ConsultasAdmin() {
  return <AuthGate><Consultas /></AuthGate>;
}
