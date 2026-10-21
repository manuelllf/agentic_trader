"use client";

// Auditoría: rastro paginado, filtrable por prefijo de acción (p. ej. «admin.» o «liga.»).

import { Boton, Estado, Fila, Lista, Pagina, Segmentos } from "../../_marco/ui";
import { fechaHora } from "../../_marco/formato";
import { describir, describirObjeto } from "./describir";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { ApiError, get } from "@/lib/api";

type Entrada = {
  id: number; actor_id: string | null; accion: string; objeto: string | null;
  detalle: unknown; creada: string;
};
type ListaAuditoria = { total: number; filas: Entrada[] };

const CUANTOS = 50;
const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Auditoria() {
  const t = useTranslations();
  const locale = useLocale();
  const [segmento, setSegmento] = useState("acciones");
  const errorText = useCallback((e: unknown) => error(e, t("admin_generic_error")), [t]);
  const [prefijo, setPrefijo] = useState("");
  const [buscando, setBuscando] = useState("");
  const [desde, setDesde] = useState(0);
  const [lista, setLista] = useState<ListaAuditoria | null>(null);
  const [fallo, setFallo] = useState("");

  // Solo vale la última petición lanzada: una respuesta lenta anterior no pisa a la nueva.
  const ultima = useRef(0);
  const cargar = useCallback((p: string, d: number) => {
    setFallo("");
    const n = ++ultima.current;
    const q = new URLSearchParams({ accion_prefix: segmento === "ia" ? `ia.${p.replace(/^ia\./, "")}` : p, sin_ia: String(segmento === "acciones"), desde: String(d), cuantos: String(CUANTOS) });
    get<ListaAuditoria>(`/liga/admin/auditoria?${q.toString()}`)
      .then((r) => { if (n === ultima.current) setLista(r); })
      .catch((e) => { if (n === ultima.current) setFallo(errorText(e)); });
  }, [errorText, segmento]);
  useEffect(() => { cargar(buscando, desde); }, [cargar, buscando, desde]);

  const buscar = (e: React.FormEvent) => {
    e.preventDefault();
    setDesde(0); setBuscando(prefijo.trim());
  };

  return <Pagina repetido titulo={t("admin_audit_title")}>
    <Segmentos etiqueta={t("admin_audit_title")} valor={segmento} alCambiar={v => { setSegmento(v); setDesde(0); }} opciones={["acciones", "ia", "todo"].map(valor => ({ valor, etiqueta: t(`admin_audit_tab_${valor}`) }))} />
    <form onSubmit={buscar} className="adm-audit-buscar">
      <input aria-label={t("admin_audit_prefix_placeholder")} value={prefijo} onChange={e => setPrefijo(e.target.value)} placeholder={t("admin_audit_prefix_placeholder")} />
      <Boton type="submit" variante="sec">{t("admin_audit_filter")}</Boton>
    </form>
    {fallo && <Estado tipo="error">{fallo}</Estado>}
    {!lista ? !fallo && <Estado tipo="cargando" /> : <>
      <Lista>{lista.filas.map(e => <Fila key={e.id}>
        <div><p>{describir(e, t, locale)}</p>{describirObjeto(e.objeto, t) && !e.accion.startsWith("ajustes.") && <p className="adm-nota">{describirObjeto(e.objeto, t)}</p>}</div>
        <span className="adm-nota">{fechaHora(e.creada, locale)}</span>
      </Fila>)}</Lista>
      {!lista.filas.length && <Estado tipo="vacio">{t("admin_audit_empty")}</Estado>}
      <div className="adm-audit-paginacion">
        {lista.total > CUANTOS && <Boton variante="sec" disabled={desde === 0} onClick={() => setDesde(Math.max(0, desde - CUANTOS))}>{t("admin_previous")}</Boton>}
        <span className="adm-nota">{t("admin_audit_range", { desde: lista.total ? desde + 1 : 0, hasta: Math.min(desde + CUANTOS, lista.total), total: lista.total })}</span>
        {lista.total > CUANTOS && <Boton variante="sec" disabled={desde + CUANTOS >= lista.total} onClick={() => setDesde(desde + CUANTOS)}>{t("admin_next")}</Boton>}
      </div>
    </>}
  </Pagina>;
}

export default function AuditoriaAdmin() {
  return (
    <AuthGate>
      <Auditoria />
    </AuthGate>
  );
}
