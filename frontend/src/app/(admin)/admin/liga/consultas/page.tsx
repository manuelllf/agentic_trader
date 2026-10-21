"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Pagina, Boton, Segmentos, Estado } from "../../_marco/ui";
import { fechaCorta } from "../../_marco/formato";
import { getCatalogo } from "@/lib/liga/api";
import AuthGate from "@/components/AuthGate";
import { get } from "@/lib/api";
import { tokenSesion } from "@/lib/liga/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const claves = ["sin_estrategia", "inactivas", "nunca_apuntadas", "reglas_usadas"] as const;
type ConsultaOut = { clave: string; columnas: string[]; filas: unknown[][]; umbral_dias: number | null };

function Consultas() {
  const t = useTranslations();
  const locale = useLocale();
  const [reglas, setReglas] = useState<Record<string, string>>({});
  useEffect(() => { let vigente = true; void getCatalogo().then(c => { if (vigente && typeof c !== "string") setReglas(Object.fromEntries(c.reglas.map(r => [r.clave, r.titulo]))); }).catch(() => {}); return () => { vigente = false; }; }, []);
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

  const celda = (valor: unknown, columna: string) => {
    if (columna === "clave" && clave === "reglas_usadas" && typeof valor === "string") return reglas[valor] ?? valor;
    if (columna === "estado" && typeof valor === "string" && ["borrador", "apuntada", "jugando", "retirada"].includes(valor)) return t(({ borrador: "strategies_state_draft", apuntada: "strategies_state_signed_up", jugando: "strategies_state_playing", retirada: "strategies_state_retired" } as Record<string, string>)[valor]);
    if (valor == null) return "·";
    if (typeof valor === "boolean") return t(valor ? "admin_consultas_si" : "admin_consultas_no");
    if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}/.test(valor)) {
      const fecha = new Date(valor);
      if (!Number.isNaN(fecha.getTime())) return fechaCorta(valor, locale);
    }
    return String(valor);
  };
  const numericas = consulta?.columnas.map((_, i) => {
    const valores = consulta.filas.map(f => f[i]).filter(v => v != null);
    return valores.length > 0 && valores.every(v => typeof v === "number");
  });
  const ayuda = consulta && ((clave === "sin_estrategia" || clave === "inactivas")
    ? consulta.umbral_dias == null ? null : t(`admin_consultas_${clave}_ayuda`, { dias: consulta.umbral_dias })
    : t(`admin_consultas_${clave}_ayuda`));

  return <Pagina repetido titulo={t("admin_consultas_titulo")} accion={<Boton variante="sec" onClick={exportar} disabled={exportando}>{t("admin_consultas_exportar")}</Boton>}>
    <Segmentos opciones={claves.map(c => ({ valor: c, etiqueta: t(`admin_consultas_${c}`), cuenta: clave === c && consulta ? consulta.filas.length : undefined }))} valor={clave} alCambiar={setClave} etiqueta={t("admin_consultas_titulo")} />
    {ayuda && <p className="adm-nota">{ayuda}</p>}
    {fallo && <Estado tipo="error">{t("admin_generic_error")}</Estado>}
    {!consulta ? !fallo && <Estado tipo="cargando" /> : <>
      <div className="overflow-x-auto"><table className="adm-tabla"><thead><tr>{consulta.columnas.map(c => <th key={c} scope="col" className={numericas?.[consulta.columnas.indexOf(c)] ? "der" : undefined}>{t(`admin_consultas_col_${c}`)}</th>)}</tr></thead>
      <tbody>{consulta.filas.map((fila, i) => <tr key={i}>{fila.map((valor, j) => <td key={j} className={numericas?.[j] ? "der" : undefined}>{celda(valor, consulta.columnas[j])}</td>)}</tr>)}</tbody></table></div>
      {!consulta.filas.length && <Estado tipo="vacio">{t("admin_consultas_vacia")}</Estado>}
    </>}
  </Pagina>;
}

export default function ConsultasAdmin() {
  return <AuthGate><Consultas /></AuthGate>;
}
