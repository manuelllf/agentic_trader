"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { get } from "@/lib/api";
import { Boton, Chip, Estado, Fila, Lista } from "../_marco/ui";
import { hace, numero } from "../_marco/formato";

type Intencion = {
  intencion: string;
  recuento: number;
  tipo: "exacta" | "aproximada" | "no_disponible";
  ultima: string;
  primera: string;
  regla: string | null;
};

export function Intenciones() {
  const t = useTranslations();
  const locale = useLocale();
  const [expandido, setExpandido] = useState(false);
  const [filas, setFilas] = useState<Intencion[] | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let activo = true;
    get<Intencion[]>("/liga/admin/intenciones?dias=90")
      .then(datos => { if (activo) setFilas(datos); })
      .catch(() => { if (activo) setFallo(true); });
    return () => { activo = false; };
  }, []);

  if (fallo) return <Estado tipo="error">{t("admin_intenciones_error")}</Estado>;
  if (filas === null) return <Estado tipo="cargando">{t("admin_intenciones_cargando")}</Estado>;
  if (!filas.length) return <Estado tipo="vacio">{t("admin_intenciones_vacio")}</Estado>;
  const visibles = expandido ? filas : filas.slice(0, 5);
  const regla = (fila: Intencion) => fila.regla === null
    ? <span className="adm-nota">{t("admin_intenciones_sin_regla")}</span>
    : fila.tipo === "aproximada"
      ? <Chip>{t("admin_intenciones_parecida", { regla: fila.regla })}</Chip>
      : fila.regla;
  return <>
    <div className="adm-intenciones-escritorio adm-tabla-caja"><table className="adm-tabla">
      <thead><tr><th scope="col">{t("admin_intenciones_pide")}</th><th scope="col" className="der">{t("admin_intenciones_recuento")}</th><th scope="col">{t("admin_intenciones_ultima")}</th><th scope="col">{t("admin_intenciones_regla")}</th></tr></thead>
      <tbody>{visibles.map(fila => <tr key={fila.intencion}>
        <td>{fila.intencion}</td><td className="der tabular-nums">{numero(fila.recuento, locale)}</td>
        <td><time dateTime={fila.ultima}>{hace(fila.ultima, locale)}</time></td>
        <td>{regla(fila)}</td>
      </tr>)}</tbody>
    </table></div>
    <Lista className="adm-intenciones-movil">{visibles.map(fila => <Fila key={fila.intencion}>
      <div>{fila.intencion}<div className="adm-nota"><time dateTime={fila.ultima}>{hace(fila.ultima, locale)}</time></div></div>
      <div><div className="num">{numero(fila.recuento, locale)}</div><div>{regla(fila)}</div></div>
    </Fila>)}</Lista>
    {filas.length > 5 && <Boton variante="texto" aria-expanded={expandido} onClick={() => setExpandido(!expandido)}>{t(expandido ? "admin_intenciones_menos" : "admin_intenciones_mas", { n: filas.length - 5 })}</Boton>}
  </>;
}
