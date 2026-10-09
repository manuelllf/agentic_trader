"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { abrirPago, type ProductoPago } from "@/lib/liga/pagos";

/* Los planes viven dentro de la app, fuera del registro: quien ya entró los elige cuando le interesa. */
const PLANES: { producto: ProductoPago; clave: "mensual" | "media" | "temporada" | "liga" }[] = [
  { producto: "mensual", clave: "mensual" },
  { producto: "media_temporada", clave: "media" },
  { producto: "temporada", clave: "temporada" },
  { producto: "pack_liga", clave: "liga" },
];

export default function Planes() {
  const t = useTranslations();
  const [ocupado, setOcupado] = useState<ProductoPago | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function elegir(producto: ProductoPago) {
    setOcupado(producto);
    setAviso(null);
    const res = await abrirPago(producto);
    if ("url" in res) {
      window.location.assign(res.url);
      return;
    }
    setAviso(t(res.error as Parameters<typeof t>[0]));
    setOcupado(null);
  }

  return <main className="planes">
    <h1>{t("planes_titulo")}</h1>
    <p className="planes-intro">{t("planes_intro")}</p>
    <ul className="planes-lista">
      {PLANES.map(({ producto, clave }) => <li key={producto} className="plan">
        <div className="plan-cabecera">
          <h2>{t(`planes_${clave}_nombre` as Parameters<typeof t>[0])}</h2>
          <p className="plan-precio">
            <span>{t(`planes_${clave}_precio` as Parameters<typeof t>[0])}</span>{" "}
            <small>{t(`planes_${clave}_periodo` as Parameters<typeof t>[0])}</small>
          </p>
        </div>
        <button type="button" className="btn plan-elegir" disabled={ocupado !== null}
          onClick={() => elegir(producto)}>
          {ocupado === producto ? t("planes_cargando") : t("planes_elegir")}
        </button>
      </li>)}
    </ul>
    {aviso && <p className="aviso" role="alert">{aviso}</p>}
  </main>;
}
