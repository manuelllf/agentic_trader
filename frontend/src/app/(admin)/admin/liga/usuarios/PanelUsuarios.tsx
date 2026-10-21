"use client";

import Link from "next/link";
import { Pagina, Boton, Segmentos, Chip, Lista, Fila, Estado } from "../../_marco/ui";
import { dolares, fechaCorta, hace } from "../../_marco/formato";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ApiError, get } from "@/lib/api";
import { AltaUsuario } from "./AltaUsuario";
import { DetalleUsuario } from "./DetalleUsuario";
import { FILTROS, ORDENES, esFiltro, esOrden, type FilaPanel, type ListaPanel } from "./panel";

const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const filtros = ["admin_panel_filter_all", "admin_panel_filter_active", "admin_panel_filter_suspended", "admin_panel_filter_adult"];
const ordenes = ["admin_panel_sort_activity", "admin_panel_sort_created", "admin_panel_sort_visits", "admin_panel_sort_ai"];


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
  const [destinoAlta, setDestinoAlta] = useState<HTMLDivElement | null>(null);
  const [texto, setTexto] = useState(q);
  const [lista, setLista] = useState<ListaPanel | null>(null);
  const [fallo, setFallo] = useState("");
  const [cargando, setCargando] = useState(true);
  const ultima = useRef(0);
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
  useEffect(() => { cargarLista(); }, [cargarLista]);
  useEffect(() => { setTexto(q); }, [q]);
  const enlace = (id: string) => `/admin/liga/usuarios/${id}` + (consulta ? `?${consulta}` : "");
  const etiquetas = (u: FilaPanel) => <>
    {u.suspendido && <Chip tono="mal">{t("admin_users_suspended")}</Chip>}
    {u.roles.filter(r => r === "admin" || r === "moderador").map(r => <Chip key={r}>{t(`admin_user_role_${r}`)}</Chip>)}
  </>;
  const actividad = (u: FilaPanel) => u.ultima_actividad ? hace(u.ultima_actividad, locale) : t("admin_panel_no_activity");
  return <Pagina titulo={t("admin_users_title")} accion={<AltaUsuario onAlta={cargarLista} destino={destinoAlta} />} className={"adm-usuarios" + (seleccionado ? " con-ficha" : "")}>
    <div ref={setDestinoAlta} className="adm-usuarios-alta-destino" />
    <div className="adm-usuarios-columnas">
      <section className="adm-usuarios-lista">
        <div className="adm-usuarios-herramientas">
          <form className="admin-buscador mt-4 flex gap-2" onSubmit={e => { e.preventDefault(); irA({ q: texto.trim() || null, desde: null }); }}>
            <input value={texto} onChange={e => setTexto(e.target.value)} placeholder={t("admin_users_search_placeholder")} aria-label={t("admin_users_search_placeholder")} />
            <Boton variante="sec" type="submit">{t("admin_users_search")}</Boton>
          </form>
          <Segmentos opciones={FILTROS.map((valor, i) => ({ valor, etiqueta: t(filtros[i]) }))} valor={filtro} alCambiar={valor => irA({ filtro: valor, desde: null })} etiqueta={t("admin_users_title")} />
          <label>{t("admin_panel_sort")} <select value={orden} onChange={e => irA({ orden: e.target.value, desde: null })}>{ORDENES.map((valor, i) => <option key={valor} value={valor}>{t(ordenes[i])}</option>)}</select></label>
        </div>
        {fallo && <Estado tipo="error">{fallo}</Estado>}
        {cargando && !lista && <Estado tipo="cargando" />}
        {lista && <>
          <Lista className="adm-usuarios-movil">{lista.filas.map(u => <Fila key={u.id} href={enlace(u.id)}><span>{u.alias} {etiquetas(u)}<span className="adm-nota block">{actividad(u)} · {t("admin_panel_mobile_visits", { count: u.visitas_7d })}</span></span><span>{dolares(u.ia_mes_usd, locale)}</span></Fila>)}</Lista>
          <table className="adm-tabla adm-usuarios-escritorio"><thead><tr>{["alias", "activity", "visits", "ai", "joined"].map(c => <th key={c} className={c === "visits" || c === "ai" ? "der" : undefined}>{t(`admin_panel_col_${c}`)}</th>)}</tr></thead>
            <tbody>{lista.filas.map(u => <tr key={u.id} className={seleccionado === u.id ? "seleccionada" : undefined} onClick={() => router.push(enlace(u.id))}>
              <td><Link href={enlace(u.id)} aria-current={seleccionado === u.id ? "true" : undefined}>{u.alias} {etiquetas(u)}</Link></td><td>{actividad(u)}</td><td className="der">{u.visitas_7d}</td><td className="der">{dolares(u.ia_mes_usd, locale)}</td><td>{fechaCorta(u.creado, locale)}</td>
            </tr>)}</tbody></table>
          {!lista.filas.length && <Estado tipo="vacio">{t("admin_users_empty")}</Estado>}
          {lista.total > 0 && <div className="adm-usuarios-paginacion"><span className="adm-nota">{t("admin_panel_pager", { from: desde + 1, to: Math.min(desde + 50, lista.total), total: lista.total })}</span>{lista.total > 50 && <><Boton variante="sec" disabled={desde === 0} onClick={() => irA({ desde: desde <= 50 ? null : String(desde - 50) })}>{t("admin_previous")}</Boton><Boton variante="sec" disabled={desde + 50 >= lista.total} onClick={() => irA({ desde: String(desde + 50) })}>{t("admin_next")}</Boton></>}</div>}
        </>}
      </section>
      {seleccionado && <aside className="adm-usuarios-ficha"><DetalleUsuario key={seleccionado} id={seleccionado} volver={"/admin/liga/usuarios" + (consulta ? "?" + consulta : "")} /></aside>}
    </div>
  </Pagina>;
}
