"use client";

// Errores que la gente reporta desde la web (botón «Reportar este error»): el código que vio
// coincide con el del registro del servidor en Railway. Se marcan como resueltos al revisarlos.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, get, post } from "@/lib/api";

import { Boton, Estado, Fila, Lista } from "../../_marco/ui";
import { hace, numero } from "../../_marco/formato";

type Aviso = {
  id: number; codigo: string | null; alias: string | null; pantalla: string; mensaje: string;
  nota: string | null; contexto: Record<string, unknown>; estado: "abierto" | "resuelto";
  creado: string;
};
type ListaErrores = { total: number; filas: Aviso[] };

const CUANTOS = 50;
const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function Errores({ estado = "abierto", alTotal }: { estado?: "abierto" | "resuelto"; alTotal: (total: number) => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const errorText = useCallback((e: unknown) => error(e, t("admin_generic_error")), [t]);
  const [lista, setLista] = useState<ListaErrores | null>(null);
  const [fallo, setFallo] = useState("");
  const [ocupado, setOcupado] = useState<number | null>(null);
  const ultima = useRef(0);

  const cargar = useCallback((e: "abierto" | "resuelto") => {
    setFallo("");
    const n = ++ultima.current;
    get<ListaErrores>(`/liga/admin/errores?estado=${e}&cuantos=${CUANTOS}`)
      .then((r) => { if (n === ultima.current) { setLista(r); alTotal(r.total); } })
      .catch((err) => { if (n === ultima.current) setFallo(errorText(err)); });
  }, [errorText, alTotal]);
  useEffect(() => { setLista(null); cargar(estado); }, [cargar, estado]);

  const resolver = async (a: Aviso) => {
    setOcupado(a.id); setFallo("");
    try {
      await post(`/liga/admin/errores/${a.id}/resolver`);
      cargar(estado);
    } catch (e) { setFallo(errorText(e)); } finally { setOcupado(null); }
  };

  return <div>
    {fallo && <Estado tipo="error">{fallo}</Estado>}
    {!lista ? !fallo && <Estado tipo="cargando" /> : lista.filas.length === 0 ? <Estado tipo="vacio">{t(estado === "abierto" ? "admin_errors_no_open" : "admin_errors_no_resolved")}</Estado> : <>
      <Lista>{lista.filas.map(a => <Fila key={a.id}>
        <div><p className="break-words">{a.mensaje}</p><p className="adm-nota break-words">{[a.codigo, a.pantalla, a.alias ?? t("admin_errors_no_session"), hace(a.creado, locale), typeof a.contexto?.ruta === "string" ? t("admin_errors_route", { route: a.contexto.ruta }) : null].filter(Boolean).join(" · ")}</p>{a.nota && <p>«{a.nota}»</p>}</div>
        {estado === "abierto" && <Boton variante="sec" disabled={ocupado === a.id} onClick={() => resolver(a)}>{t("admin_errors_resolve")}</Boton>}
      </Fila>)}</Lista>
      {lista.total > lista.filas.length && <p className="adm-nota">{t("admin_errors_count", { total: numero(lista.total, locale), shown: numero(lista.filas.length, locale) })}</p>}
    </>}
  </div>;
}
