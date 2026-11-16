"use client";

import { useLocale, useTranslations } from "next-intl";
import { numero, porcentajeSimple, fechaHora } from "../_marco/formato";
import { destinoDe, nombreProceso, pasoClave, textoPendiente, titular } from "../liga/resumen/logica";
import { cuentasPorSeccion, useResumenPanel } from "./resumen";
import { GRUPOS_SECCIONES, type ClaveSeccion } from "./salas";
import { Celda, Datos, Esqueleto, Grupo } from "./ui";

/** Inicio de Vennett: lista tipo Ajustes de iOS. Solo muestra lo que da `/liga/admin/panel/resumen`. */
export default function PortadaVennett() {
  const t = useTranslations();
  const locale = useLocale();
  const { datos, fallo } = useResumenPanel();
  const cuentas = datos ? cuentasPorSeccion(datos.pendientes) : {};
  const topeIa = datos?.vistazo.tope_ia_pct ?? null;

  const valorDe = (clave: ClaveSeccion): string | undefined => {
    if (!datos) return undefined;
    if (clave === "usuarios") return numero(datos.vistazo.cuentas, locale);
    if (clave === "jornadas" && datos.proximo) return t("admin_pnl_valor_jornada", { jornada: datos.proximo.jornada });
    if (clave === "coste" && topeIa !== null) return porcentajeSimple(topeIa, locale);
    return undefined;
  };

  const proximo = datos?.proximo ?? null;
  return (
    <div className="pnl-llega">
      {fallo && <p className="pnl-pie-grupo" role="alert">{t("admin_generic_error")}</p>}
      {!datos && !fallo && <Esqueleto filas={3} etiqueta={t("admin_pnl_cargando")} />}
      {datos && (
        <>
          <p className="pnl-titular">{t(...titular(datos.pendientes.length))}</p>
          {datos.pendientes.length > 0 && (
            <Grupo>{datos.pendientes.map((p, i) => {
              const texto = textoPendiente(p, id => { const clave = nombreProceso(id); return clave === id ? id : t(clave); });
              return <Celda key={`${p.tipo}-${i}`} titulo={t(texto.clave, texto.valores)} subtitulo={t(`admin_pnl_sec_${p.seccion}`)} href={destinoDe(p.seccion)} />;
            })}</Grupo>
          )}
          {proximo && (
            <Grupo cabecera={t("admin_resumen_proximo_titulo")}>
              <Celda titulo={t("admin_resumen_proximo_linea", {
                paso: t(pasoClave(proximo.paso), { jornada: proximo.jornada }), jornada: numero(proximo.jornada, locale),
                fecha: `${new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(proximo.cuando))} ${fechaHora(proximo.cuando, locale)}`,
                modo: t(proximo.automatico ? "admin_resumen_auto" : "admin_resumen_manual"),
              })} />
            </Grupo>
          )}
          <h2 className="pnl-cab-grupo">{t("admin_resumen_vistazo")}</h2>
          <Datos items={[
            { etiqueta: t("admin_resumen_cuentas"), valor: numero(datos.vistazo.cuentas, locale) },
            { etiqueta: t("admin_resumen_activas"), valor: numero(datos.vistazo.activas_7d, locale) },
            { etiqueta: t("admin_resumen_en_juego"), valor: numero(datos.vistazo.en_juego, locale) },
            { etiqueta: t("admin_resumen_tope_ia"), valor: topeIa === null ? t("admin_panel_sin_tope") : porcentajeSimple(topeIa, locale) },
          ]} />
        </>
      )}
      {GRUPOS_SECCIONES.map(g => (
        <Grupo key={g.clave} cabecera={t(`admin_pnl_grupo_${g.clave}`)}>
          {g.secciones.map(s => (
            <Celda key={s.clave} titulo={t(`admin_pnl_sec_${s.clave}`)} href={s.href} deshabilitada={s.pronto}
              cuenta={cuentas[s.clave]} valor={s.pronto ? t("admin_pnl_pronto") : valorDe(s.clave)} />
          ))}
        </Grupo>
      ))}
    </div>
  );
}
