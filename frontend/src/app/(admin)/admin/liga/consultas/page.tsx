"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { get } from "@/lib/api";
import { tokenSesion } from "@/lib/liga/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const claves = ["sin_estrategia", "inactivas", "nunca_apuntadas", "reglas_usadas"] as const;
type ConsultaOut = { clave: string; columnas: string[]; filas: unknown[][]; umbral_dias: number | null };

function Consultas() {
  const t = useTranslations();
  const locale = useLocale();
  const [clave, setClave] = useState<(typeof claves)[number]>("sin_estrategia");
  const [consulta, setConsulta] = useState<ConsultaOut | null>(null);
  const [fallo, setFallo] = useState(false);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    let vigente = true;
    setConsulta(null); setFallo(false);
    get<ConsultaOut>(`/liga/admin/panel/consultas/${clave}`)
      .then((r) => { if (vigente) setConsulta(r); })
      .catch(() => { if (vigente) setFallo(true); });
    return () => { vigente = false; };
  }, [clave]);

  const exportar = async () => {
    setExportando(true); setFallo(false);
    try {
      const sesion = await tokenSesion();
      const token = sesion?.aal === "aal2" ? sesion.token : null;
      const r = await fetch(`${API_URL}/liga/admin/panel/consultas/${clave}?formato=csv`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!r.ok) throw new Error();
      const nombre = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1]
        ?? `${clave}.csv`;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { setFallo(true); } finally { setExportando(false); }
  };

  const celda = (valor: unknown) => {
    if (valor == null) return "·";
    if (typeof valor === "boolean") return t(valor ? "admin_consultas_si" : "admin_consultas_no");
    if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}/.test(valor)) {
      const fecha = new Date(valor);
      if (!Number.isNaN(fecha.getTime())) return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeZone: "UTC" }).format(fecha);
    }
    return String(valor);
  };
  const ayuda = consulta && ((clave === "sin_estrategia" || clave === "inactivas")
    ? consulta.umbral_dias == null ? null : t(`admin_consultas_${clave}_ayuda`, { dias: consulta.umbral_dias })
    : t(`admin_consultas_${clave}_ayuda`));

  return (
    <div className="admin-escritorio mx-auto max-w-md px-4 pb-16 pt-6 min-w-0 text-[13px]" style={{ color: "#c3c2b7" }}>
      <h1 className="text-[19px] text-white" style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>{t("admin_consultas_titulo")}</h1>
      <p className="mt-1" style={{ color: "#898781" }}>{t("admin_consultas_sub")}</p>
      <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-2">
          {claves.map((c) => (
            <button key={c} type="button" aria-current={clave === c ? "true" : undefined} onClick={() => setClave(c)}
                    className="min-h-[44px] rounded-lg px-3 py-2 text-left font-bold"
                    style={{ background: clave === c ? "#3987e5" : "#2c2c2a", color: clave === c ? "#fff" : "#c3c2b7" }}>
              {t(`admin_consultas_${c}`)}
            </button>
          ))}
        </div>
        <section className="min-w-0">
          <h2 className="font-bold text-white">{t(`admin_consultas_${clave}`)}</h2>
          {ayuda && <p className="mt-1" style={{ color: "#898781" }}>{ayuda}</p>}
          <button type="button" onClick={exportar} disabled={exportando}
                  className="mt-3 min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40" style={{ background: "#2c2c2a" }}>
            {t("admin_consultas_exportar")}
          </button>
          {fallo && <p role="alert" className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{t("admin_generic_error")}</p>}
          {!consulta ? (!fallo && <p className="mt-4" style={{ color: "#898781" }}>{t("admin_loading")}</p>) : (
            <>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left">
                  <thead><tr>{consulta.columnas.map((columna, i) => <th key={i} scope="col" className="border-b p-2 text-white" style={{ borderColor: "#303030" }}>{columna}</th>)}</tr></thead>
                  <tbody>{consulta.filas.map((fila, i) => (
                    <tr key={i}>{fila.map((valor, j) => <td key={j} className="border-b p-2" style={{ borderColor: "#303030" }}>{celda(valor)}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
              {consulta.filas.length === 0 && <p className="mt-4" style={{ color: "#898781" }}>{t("admin_consultas_vacia")}</p>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default function ConsultasAdmin() {
  return <AuthGate><Consultas /></AuthGate>;
}
