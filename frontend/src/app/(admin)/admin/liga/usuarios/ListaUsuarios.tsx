"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ApiError, get } from "@/lib/api";
import { dolares, fechaCorta, hace } from "../../_marco/formato";
import { Buscador, Celda, ChipFiltro, Chips, Esqueleto, Grupo, Vacio } from "../../_panel/ui";
import { AltaHoja } from "./AltaHoja";
import { FILTROS, ORDENES, esFiltro, esOrden, type FilaPanel, type ListaPanel } from "./panel";
import { ICO_MAS, MenuOrden } from "./pp";

const POR_PAGINA = 50;
const PAUSA_BUSCADOR_MS = 350;
const CLAVE_FILTRO = { todas: "todas", activas: "activas", suspendidas: "suspendidas", mayores18: "mayores" } as const;
const CLAVE_ORDEN = { ultima_actividad: "actividad", creado: "alta", visitas_7d: "visitas", ia_mes_usd: "ia" } as const;
const ROLES_VISIBLES = ["admin", "moderador"];

/** Lista de cuentas con buscador, filtros y orden en la URL; cada fila abre su ficha. */
export function ListaUsuarios() {
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
  const [lista, setLista] = useState<ListaPanel | null>(null);
  const [fallo, setFallo] = useState("");
  const [cargando, setCargando] = useState(true);
  const [alta, setAlta] = useState(false);
  const ultima = useRef(0);
  const enviado = useRef(q);

  const irA = useCallback((cambios: Record<string, string | null>) => {
    const nuevo = new URLSearchParams(consulta);
    Object.entries(cambios).forEach(([clave, valor]) => { if (valor === null) nuevo.delete(clave); else nuevo.set(clave, valor); });
    const qs = nuevo.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [consulta, pathname, router]);

  const cargarLista = useCallback(() => {
    const n = ++ultima.current;
    setCargando(true); setFallo("");
    const qs = new URLSearchParams({ q, filtro, orden, desde: String(desde), cuantos: String(POR_PAGINA) });
    get<ListaPanel>(`/liga/admin/panel-usuarios?${qs}`)
      .then(r => { if (n === ultima.current) setLista(r); })
      .catch(e => { if (n === ultima.current) setFallo(e instanceof ApiError ? e.message : t("admin_generic_error")); })
      .finally(() => { if (n === ultima.current) setCargando(false); });
  }, [q, filtro, orden, desde, t]);
  useEffect(() => { cargarLista(); }, [cargarLista]);

  // Lo escrito sube a la URL tras una pausa; un cambio de URL ajeno (atrás, enlace) vuelve al campo.
  useEffect(() => { if (q !== enviado.current) { enviado.current = q; setTexto(q); } }, [q]);
  useEffect(() => {
    const limpio = texto.trim();
    if (limpio === enviado.current) return;
    const id = setTimeout(() => { enviado.current = limpio; irA({ q: limpio || null, desde: null }); }, PAUSA_BUSCADOR_MS);
    return () => clearTimeout(id);
  }, [texto, irA]);

  const enlace = (id: string) => `/admin/liga/usuarios/${id}` + (consulta ? `?${consulta}` : "");
  const etiquetas = (u: FilaPanel) => (
    <>
      {u.pro && <span className="pp-etq">{t("pnl_personas_etq_pro")}</span>}
      {u.suspendido && <span className="pp-etq">{t("pnl_personas_etq_suspendido")}</span>}
      {u.roles.filter(r => ROLES_VISIBLES.includes(r)).map(r => <span key={r} className="pp-etq">{t(`pnl_personas_rol_${r}`)}</span>)}
    </>
  );
  const detalle = (u: FilaPanel) => (
    <span className="pp-sub">
      <span>{t("pnl_personas_alta_el", { fecha: fechaCorta(u.creado, locale) })}</span>
      <span>{u.ultima_actividad ? hace(u.ultima_actividad, locale) : t("pnl_personas_sin_actividad")} · {t("pnl_personas_visitas_7d", { count: u.visitas_7d })}</span>
    </span>
  );

  const filas = lista?.filas ?? [];
  const hasta = lista ? Math.min(desde + POR_PAGINA, lista.total) : 0;
  return (
    <div className="pnl-llega">
      <Buscador valor={texto} onCambio={setTexto} etiqueta={t("pnl_personas_buscar")} />
      <Chips etiqueta={t("pnl_personas_filtro_aria")}>
        {FILTROS.map(valor => (
          <ChipFiltro key={valor} activo={filtro === valor} onClick={() => irA({ filtro: valor === "todas" ? null : valor, desde: null })}>
            {t(`pnl_personas_filtro_${CLAVE_FILTRO[valor]}`)}
          </ChipFiltro>
        ))}
      </Chips>
      <div className="pp-herramientas">
        <button type="button" className="pp-accion" onClick={() => setAlta(true)}>{ICO_MAS}{t("pnl_personas_alta_boton")}</button>
        <MenuOrden etiqueta={t("pnl_personas_orden")} titulo={t("pnl_personas_orden_titulo")} valor={orden}
          opciones={ORDENES.map(valor => ({ valor, etiqueta: t(`pnl_personas_orden_${CLAVE_ORDEN[valor]}`) }))}
          onElegir={valor => irA({ orden: valor === "ultima_actividad" ? null : valor, desde: null })} />
      </div>

      {fallo && <p className="pnl-pie-grupo" role="alert">{fallo}</p>}
      {!lista && cargando && <Esqueleto filas={6} etiqueta={t("admin_pnl_cargando")} />}
      {lista && (
        <div className={`pp-lista${cargando ? " ocupada" : ""}`} aria-busy={cargando}>
          {filas.length === 0 ? (
            <Vacio titulo={t("pnl_personas_vacio_titulo")} texto={t("pnl_personas_vacio_texto")} />
          ) : (
            <Grupo cabecera={t("pnl_personas_lista_cab", { count: lista.total, orden: t(`pnl_personas_orden_${CLAVE_ORDEN[orden]}`).toLowerCase() })}
              pie={t("pnl_personas_lista_pie")}>
              {filas.map(u => (
                <Celda key={u.id} href={enlace(u.id)} titulo={<>{u.alias}{etiquetas(u)}</>} subtitulo={detalle(u)} valor={dolares(u.ia_mes_usd, locale)} />
              ))}
            </Grupo>
          )}
          {lista.total > POR_PAGINA && (
            <div className="pp-pager">
              <button type="button" disabled={desde === 0} onClick={() => irA({ desde: desde <= POR_PAGINA ? null : String(desde - POR_PAGINA) })}>{t("admin_previous")}</button>
              <span>{t("pnl_personas_paginacion", { from: desde + 1, to: hasta, total: lista.total })}</span>
              <button type="button" disabled={desde + POR_PAGINA >= lista.total} onClick={() => irA({ desde: String(desde + POR_PAGINA) })}>{t("admin_next")}</button>
            </div>
          )}
          {lista.total > 0 && lista.total <= POR_PAGINA && <p className="pnl-pie-grupo">{t("pnl_personas_paginacion", { from: 1, to: lista.total, total: lista.total })}</p>}
        </div>
      )}
      {alta && <AltaHoja onAlta={cargarLista} onCerrar={() => setAlta(false)} />}
    </div>
  );
}
