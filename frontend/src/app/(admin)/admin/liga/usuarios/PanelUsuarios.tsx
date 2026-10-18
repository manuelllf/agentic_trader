"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ApiError, get } from "@/lib/api";
import { AltaUsuario } from "./AltaUsuario";
import { DetalleUsuario } from "./DetalleUsuario";
import { FILTROS, ORDENES, esFiltro, esOrden, formatoUsd, type FilaPanel, type ListaPanel, type ResumenPanel } from "./panel";

const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const filtros = ["admin_panel_filter_all", "admin_panel_filter_active", "admin_panel_filter_pro", "admin_panel_filter_suspended", "admin_panel_filter_adult"];
const ordenes = ["admin_panel_sort_activity", "admin_panel_sort_created", "admin_panel_sort_visits", "admin_panel_sort_ai"];
const boton = "min-h-[44px] rounded-lg border px-3 disabled:opacity-40";
const borde = { borderColor: "#303030" };

export function PanelUsuarios({ seleccionado }: { seleccionado?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const consulta = params.toString();
  const q = params.get("q") ?? "";
  const f = params.get("filtro");
  const o = params.get("orden");
  const filtro = esFiltro(f) ? f : "todas";
  const orden = esOrden(o) ? o : "ultima_actividad";
  const numero = Number(params.get("desde"));
  const desde = Number.isFinite(numero) ? Math.max(0, Math.floor(numero)) : 0;
  const [texto, setTexto] = useState(q);
  const [resumen, setResumen] = useState<ResumenPanel | null>(null);
  const [lista, setLista] = useState<ListaPanel | null>(null);
  const [fallo, setFallo] = useState("");
  const [cargando, setCargando] = useState(true);
  const ultima = useRef(0);
  const ultimoResumen = useRef(0);
  const usd = (v: string) => formatoUsd(locale).format(Number(v));
  const FECHA = new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric", year: "numeric" });
  const FECHA_HORA = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const irA = (cambios: Record<string, string | null>) => {
    const nuevo = new URLSearchParams(consulta);
    Object.entries(cambios).forEach(([clave, valor]) => { if (valor === null) nuevo.delete(clave); else nuevo.set(clave, valor); });
    router.replace(`${pathname}?${nuevo}`);
  };
  const cargarLista = useCallback(() => {
    const n = ++ultima.current;
    setCargando(true); setFallo("");
    const qs = new URLSearchParams({ q, filtro, orden, desde: String(desde), cuantos: "50" });
    get<ListaPanel>(`/liga/admin/panel-usuarios?${qs}`)
      .then((r) => { if (n === ultima.current) setLista(r); })
      .catch((e) => { if (n === ultima.current) setFallo(error(e, t("admin_generic_error"))); })
      .finally(() => { if (n === ultima.current) setCargando(false); });
  }, [q, filtro, orden, desde, t]);
  const cargarResumen = useCallback(() => {
    const n = ++ultimoResumen.current;
    get<ResumenPanel>("/liga/admin/panel-usuarios/resumen")
      .then((r) => { if (n === ultimoResumen.current) setResumen(r); })
      .catch((e) => { if (n === ultimoResumen.current) setFallo(error(e, t("admin_generic_error"))); });
  }, [t]);
  const cargarTodo = () => { cargarLista(); cargarResumen(); };
  useEffect(() => { cargarLista(); }, [cargarLista]);
  useEffect(() => { cargarResumen(); }, [cargarResumen]);
  useEffect(() => { setTexto(q); }, [q]);
  const enlace = (id: string) => `/admin/liga/usuarios/${id}` + (consulta ? `?${consulta}` : "");
  const etiquetas = (u: FilaPanel) => <>
    {u.pro && <span className="ml-2 rounded px-1.5 py-0.5 text-[11px]" style={{ background: "#1f5f3a", color: "#9be0b3" }}>{t("admin_users_pro")}</span>}
    {u.suspendido && <span className="ml-2 rounded px-1.5 py-0.5 text-[11px]" style={{ background: "#2a1616", color: "#e66767" }}>{t("admin_users_suspended")}</span>}
    {u.roles.filter((r) => r === "moderador" || r === "admin").map((r) => <span key={r} className="ml-2 text-[11px]">{t(`admin_user_role_${r}`)}</span>)}
  </>;
  const actividad = (u: FilaPanel) => u.ultima_actividad ? t("admin_panel_seen", { date: FECHA_HORA.format(new Date(u.ultima_actividad)) }) : t("admin_panel_no_activity");
  const kpis = resumen ? [
    ["admin_panel_kpi_accounts", `${resumen.cuentas} · ${t("admin_panel_kpi_new", { count: resumen.nuevas_7d })}`],
    ["admin_panel_kpi_active", resumen.activas_7d],
    ["admin_panel_kpi_visits", resumen.visitas_7d],
    ["admin_panel_kpi_pro", t("admin_panel_kpi_pro_value", { pro: resumen.pro_vigentes, passes: resumen.pases_vigentes })],
    ["admin_panel_kpi_ai", resumen.tope_mensual_usd == null ? usd(resumen.ia_mes_usd) : t("admin_panel_kpi_ai_value", { total: usd(resumen.ia_mes_usd), cap: usd(resumen.tope_mensual_usd) })],
    ["admin_panel_kpi_collected", usd(resumen.cobrado_mes_usd)],
  ] as const : [];

  return (
    <main className="admin-escritorio mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <div className={"usuarios-dos" + (seleccionado ? " con-detalle" : "")}>
        <section className="usuarios-lista">
          <Link href="/admin/liga" className="text-[12.5px]" style={{ color: "#898781" }}>{t("admin_back_vennett")}</Link>
          <h1 className="mt-3 text-[19px] text-white" style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>{t("admin_users_title")}</h1>
          <dl className="mt-4">{kpis.map(([clave, valor]) => <div key={clave} className="flex justify-between gap-3 border-b py-2" style={borde}><dt>{t(clave)}</dt><dd className="text-right text-white">{valor}</dd></div>)}</dl>
          <Link href="/admin/liga/coste-ia" className="mt-2 inline-block">{t("admin_panel_cost_link")}</Link>
          <AltaUsuario onAlta={cargarTodo} />
          <p className="mt-2 text-[12px]" style={{ color: "#898781" }}>{t("admin_panel_note_create")}</p>
          <form className="admin-buscador mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); irA({ q: texto.trim() || null, desde: null }); }}>
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={t("admin_users_search_placeholder")} aria-label={t("admin_users_search_placeholder")} className="min-h-[44px] min-w-0 flex-1 rounded-lg border px-3 text-white" style={{ background: "#141413", ...borde }} />
            <button type="submit" className={boton + " font-bold text-white"} style={{ background: "#3987e5", ...borde }}>{t("admin_users_search")}</button>
          </form>
          <div role="group" aria-label={t("admin_users_title")} className="mt-3 flex flex-wrap gap-2">
            {FILTROS.map((valor, i) => <button key={valor} type="button" className={boton} style={{ ...borde, background: filtro === valor ? "#303030" : "#141413" }} aria-pressed={filtro === valor} onClick={() => irA({ filtro: valor, desde: null })}>{t(filtros[i])}</button>)}
          </div>
          <label className="mt-3 flex items-center gap-2">{t("admin_panel_sort")}
            <select value={orden} onChange={(e) => irA({ orden: e.target.value, desde: null })} className={boton + " text-white"} style={{ background: "#141413", ...borde }}>
              {ORDENES.map((valor, i) => <option key={valor} value={valor}>{t(ordenes[i])}</option>)}
            </select>
          </label>
          {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
          {cargando && !lista && <p className="mt-6" style={{ color: "#898781" }}>{t("admin_loading")}</p>}
          {lista && <>
            <ul className="usuarios-solo-movil mt-4 border-t" style={borde}>
              {lista.filas.map((u) => <li key={u.id} className="border-b" style={borde}>
                <Link href={enlace(u.id)} aria-current={seleccionado === u.id ? "true" : undefined} className="flex min-h-[56px] flex-wrap items-center justify-between gap-2 py-3">
                  <span><span className="text-white">{u.alias}</span>{etiquetas(u)}</span>
                  <span className="text-right text-white">{usd(u.ia_mes_usd)}<small className="block" style={{ color: "#898781" }}>{t("admin_panel_col_ai")}</small></span>
                  <span className="w-full text-[12px]" style={{ color: "#898781" }}>{t("admin_panel_row_meta", { visits: u.visitas_total, joined: FECHA.format(new Date(u.creado)) })} · {actividad(u)}</span>
                </Link>
              </li>)}
            </ul>
            <table className="tabla usuarios-solo-escritorio w-full border-collapse text-[13px]">
              <thead><tr><th className="px-2 py-2 text-left align-bottom text-[12px] font-normal" style={{ color: "#898781" }}>{t("admin_panel_col_alias")}</th><th className="text-right px-2 py-2 text-left align-bottom text-[12px] font-normal" style={{ color: "#898781" }}>{t("admin_panel_col_visits")}</th><th className="px-2 py-2 text-left align-bottom text-[12px] font-normal" style={{ color: "#898781" }}>{t("admin_panel_col_activity")}</th><th className="text-right px-2 py-2 text-left align-bottom text-[12px] font-normal" style={{ color: "#898781" }}>{t("admin_panel_col_ai")}</th><th className="px-2 py-2 text-left align-bottom text-[12px] font-normal" style={{ color: "#898781" }}>{t("admin_panel_col_joined")}</th></tr></thead>
              <tbody>{lista.filas.map((u) => <tr key={u.id}>
                <td className="px-2 py-2 align-top"><Link href={enlace(u.id)} aria-current={seleccionado === u.id ? "true" : undefined}><span className="text-white">{u.alias}</span>{etiquetas(u)}</Link></td>
                <td className="text-right px-2 py-2 align-top tabular-nums whitespace-nowrap">{u.visitas_7d}</td><td className="px-2 py-2 align-top">{actividad(u)}</td><td className="text-right px-2 py-2 align-top tabular-nums whitespace-nowrap">{usd(u.ia_mes_usd)}</td><td className="px-2 py-2 align-top whitespace-nowrap">{FECHA.format(new Date(u.creado))}</td>
              </tr>)}</tbody>
            </table>
            {lista.filas.length === 0 && <p className="mt-4" style={{ color: "#898781" }}>{t("admin_users_empty")}</p>}
            {lista.total > 0 && <>
              <p className="mt-4">{t("admin_panel_pager", { from: desde + 1, to: Math.min(desde + 50, lista.total), total: lista.total })}</p>
              <div className="mt-2 flex justify-between gap-2">
                <button type="button" className={boton} style={borde} disabled={desde === 0} onClick={() => irA({ desde: desde <= 50 ? null : String(desde - 50) })}>{t("admin_previous")}</button>
                <button type="button" className={boton} style={borde} disabled={desde + 50 >= lista.total} onClick={() => irA({ desde: String(desde + 50) })}>{t("admin_next")}</button>
              </div>
            </>}
          </>}
        </section>
        <aside className="usuarios-detalle">
          {seleccionado ? <DetalleUsuario key={seleccionado} id={seleccionado} volver={"/admin/liga/usuarios" + (consulta ? "?" + consulta : "")} /> : <p>{t("admin_panel_pick")}</p>}
        </aside>
      </div>
    </main>
  );
}
