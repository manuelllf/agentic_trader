"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { get } from "@/lib/api";
import { miles } from "@/lib/liga/format";

type Intencion = {
  intencion: string;
  recuento: number;
  tipo: "aproximada" | "no_disponible";
  regla: string | null;
};

export function Intenciones() {
  const t = useTranslations();
  const [filas, setFilas] = useState<Intencion[] | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let activo = true;
    get<Intencion[]>("/liga/admin/intenciones?dias=90")
      .then(datos => { if (activo) setFilas(datos); })
      .catch(() => { if (activo) setFallo(true); });
    return () => { activo = false; };
  }, []);

  return (
    <section className="mt-6 min-w-0" aria-labelledby="intenciones-titulo">
      <h2 id="intenciones-titulo" className="font-bold text-white">{t("admin_intenciones_titulo")}</h2>
      <p className="mt-1">{t("admin_intenciones_periodo")}</p>
      {fallo ? <p role="alert" className="mt-3">{t("admin_intenciones_error")}</p>
        : filas === null ? <p role="status" className="mt-3">{t("admin_intenciones_cargando")}</p>
        : filas.length === 0 ? <p className="mt-3">{t("admin_intenciones_vacio")}</p>
        : <div className="mt-3 max-w-full overflow-x-auto">
          <table className="w-full table-fixed text-left text-[12px]">
            <thead><tr className="border-b border-white/15">
              <th scope="col" className="w-[35%] py-2 pr-2 break-words">{t("admin_intenciones_intencion")}</th>
              <th scope="col" className="w-[20%] py-2 pr-2 break-words">{t("admin_intenciones_recuento")}</th>
              <th scope="col" className="w-[25%] py-2 pr-2 break-words">{t("admin_intenciones_tipo")}</th>
              <th scope="col" className="w-[20%] py-2 break-words">{t("admin_intenciones_regla")}</th>
            </tr></thead>
            <tbody>{filas.map(fila => <tr key={fila.intencion} className="border-b border-white/15 align-top">
              <td className="py-2 pr-2 [overflow-wrap:anywhere]">{fila.intencion}</td>
              <td className="py-2 pr-2 tabular-nums [overflow-wrap:anywhere]">{miles(fila.recuento)}</td>
              <td className="py-2 pr-2 [overflow-wrap:anywhere]">{t(`admin_intenciones_tipo_${fila.tipo}`)}</td>
              <td className="py-2 [overflow-wrap:anywhere]">{fila.regla ?? t("admin_intenciones_sin_regla")}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>
  );
}
