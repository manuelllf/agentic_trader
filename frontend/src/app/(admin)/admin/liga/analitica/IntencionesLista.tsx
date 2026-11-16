"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { get } from "@/lib/api";
import { hace, numero } from "../../_marco/formato";
import { Celda, Esqueleto, Grupo } from "../../_panel/ui";

type Intencion = {
  intencion: string; recuento: number; tipo: "exacta" | "aproximada" | "no_disponible";
  ultima: string; primera: string; regla: string | null;
};

const VISIBLES = 5;

/** Lo que piden las cuentas y aún no hay, de los últimos 90 días. */
export function IntencionesLista() {
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

  if (fallo) return <p className="pnl-pie-grupo" role="alert">{t("pnl_personas_intenciones_error")}</p>;
  if (filas === null) return <Esqueleto filas={3} etiqueta={t("admin_pnl_cargando")} />;
  if (!filas.length) return <p className="pnl-pie-grupo">{t("pnl_personas_intenciones_vacio")}</p>;
  const visibles = expandido ? filas : filas.slice(0, VISIBLES);
  const regla = (f: Intencion) => f.regla === null ? t("pnl_personas_intenciones_sin_regla")
    : f.tipo === "aproximada" ? t("pnl_personas_intenciones_parecida", { regla: f.regla }) : f.regla;
  return (
    <Grupo>
      {visibles.map(f => (
        <Celda key={f.intencion} titulo={f.intencion} valor={numero(f.recuento, locale)}
          subtitulo={<span className="pp-sub"><span>{hace(f.ultima, locale)}</span><span>{regla(f)}</span></span>} />
      ))}
      {filas.length > VISIBLES && (
        <Celda tono="accion" titulo={t(expandido ? "pnl_personas_intenciones_menos" : "pnl_personas_intenciones_mas", { n: filas.length - VISIBLES })} onClick={() => setExpandido(!expandido)} />
      )}
    </Grupo>
  );
}
