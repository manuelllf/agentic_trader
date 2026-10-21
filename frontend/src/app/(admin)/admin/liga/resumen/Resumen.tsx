"use client";

import { Pagina, Bloque, Cifras, Cifra, Lista, Fila, Chip, Estado } from "../../_marco/ui";
import { numero, porcentajeSimple, fechaHora } from "../../_marco/formato";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { get } from "@/lib/api";
import { destinoDe, nombreProceso, pasoClave, textoPendiente, titular, type Pendiente } from "./logica";

export type ResumenAdminOut = {
  pendientes: Pendiente[];
  proximo: { paso: "foto" | "formar" | "cerrar"; jornada: number; cuando: string; automatico: boolean } | null;
  vistazo: { cuentas: number; activas_7d: number; en_juego: number; tope_ia_pct: number | string | null };
};

export default function Resumen() {
  const t = useTranslations();
  const locale = useLocale();
  const [datos, setDatos] = useState<ResumenAdminOut | null>(null);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    let activo = true;
    get<ResumenAdminOut>("/liga/admin/panel/resumen")
      .then(d => { if (activo) setDatos(d); })
      .catch(() => { if (activo) setFallo(true); });
    return () => { activo = false; };
  }, []);
  if (fallo) return <Estado tipo="error">{t("admin_generic_error")}</Estado>;
  if (!datos) return <Estado tipo="cargando" />;
  const proximo = datos.proximo;
  return <Pagina titulo={t(...titular(datos.pendientes.length))}>
    {datos.pendientes.length > 0 && <Lista>{datos.pendientes.map((p, i) => {
      const texto = textoPendiente(p, id => { const clave = nombreProceso(id); return clave === id ? id : t(clave); });
      return <Fila key={`${p.tipo}-${i}`} href={destinoDe(p.seccion)}>
        <span>{t(texto.clave, texto.valores)}</span>
        <Chip tono={p.tipo === "proceso_fallido" ? "mal" : "aviso"}>{t(`admin_marco_${p.seccion}`)}</Chip>
      </Fila>;
    })}</Lista>}
    {proximo && <Bloque titulo={t("admin_resumen_proximo_titulo")}>
      <p>{t("admin_resumen_proximo_linea", {
        paso: t(pasoClave(proximo.paso), { jornada: proximo.jornada }), jornada: numero(proximo.jornada, locale),
        fecha: `${new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(proximo.cuando))} ${fechaHora(proximo.cuando, locale)}`,
        modo: t(proximo.automatico ? "admin_resumen_auto" : "admin_resumen_manual"),
      })}</p>
    </Bloque>}
    <Bloque titulo={t("admin_resumen_vistazo")}><Cifras>
      <Cifra etiqueta={t("admin_resumen_cuentas")} valor={numero(datos.vistazo.cuentas, locale)} href="/admin/liga/analitica" />
      <Cifra etiqueta={t("admin_resumen_activas")} valor={numero(datos.vistazo.activas_7d, locale)} href="/admin/liga/analitica" />
      <Cifra etiqueta={t("admin_resumen_en_juego")} valor={numero(datos.vistazo.en_juego, locale)} href="/admin/liga/jornadas" />
      <Cifra etiqueta={t("admin_resumen_tope_ia")} valor={datos.vistazo.tope_ia_pct === null ? t("admin_panel_sin_tope") : porcentajeSimple(datos.vistazo.tope_ia_pct, locale)} href="/admin/liga/coste-ia" tono={datos.pendientes.some(p => p.tipo === "tope_ia") ? "aviso" : undefined} />
    </Cifras></Bloque>
  </Pagina>;
}
