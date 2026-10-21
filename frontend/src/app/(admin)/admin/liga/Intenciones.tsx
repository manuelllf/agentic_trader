"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { get } from "@/lib/api";
import { Boton, Chip, Estado } from "../_marco/ui";
import { numero } from "../_marco/formato";

type Intencion = {
  intencion: string;
  recuento: number;
  tipo: "aproximada" | "no_disponible";
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
  return <>
    <div className="adm-tabla-caja"><table className="adm-tabla">
      <thead><tr><th scope="col">{t("admin_intenciones_intencion")}</th><th scope="col" className="der">{t("admin_intenciones_recuento")}</th><th scope="col">{t("admin_intenciones_regla")}</th></tr></thead>
      <tbody>{(expandido ? filas : filas.slice(0, 5)).map(fila => <tr key={fila.intencion}>
        <td>{fila.intencion}</td><td className="der tabular-nums">{numero(fila.recuento, locale)}</td>
        <td>{fila.regla === null ? <span className="adm-nota">{t("admin_intenciones_sin_regla")}</span> : <>{fila.regla} {fila.tipo === "aproximada" && <Chip>{t("admin_intenciones_tipo_aproximada")}</Chip>}</>}</td>
      </tr>)}</tbody>
    </table></div>
    {filas.length > 5 && <Boton variante="texto" aria-expanded={expandido} onClick={() => setExpandido(!expandido)}>{t(expandido ? "admin_intenciones_menos" : "admin_intenciones_mas", { n: filas.length - 5 })}</Boton>}
  </>;
}
