"use client";

import { useLocale, useTranslations } from "next-intl";
import { porcentajeConSigno } from "../../_marco/formato";
import { Celda, Grupo } from "../../_panel/ui";

type Datos = Record<string, unknown>;
const campos: Record<string, [string, string][]> = {
  temporadas: [["crearia", "crearia"], ["creadas", "creadas"], ["ya_existen", "existen"], ["casa_por_crear", "casas"]],
  foto: [["foto_id", "foto"], ["scan_run_id", "escaneo"], ["plan_b", "plan_b"], ["empresas", "empresas_foto"], ["con_notas", "notas"], ["avisos", "avisos"]],
  formar: [["foto_id", "foto"], ["scan_run_id", "escaneo"], ["plan_b", "plan_b"], ["empresas", "empresas"], ["con_notas", "notas"], ["n_estrategias", "estrategias"], ["inscripciones", "estrategias"], ["n_omitidas", "omitidas"], ["tickers", "valores"], ["sin_precio", "sin_precio"], ["casa_por_crear", "casas"], ["pregunta_pendientes", "preguntas"], ["pregunta_coste_estimado_usd", "coste"]],
  diario: [["activo", "automatico"], ["n_tickers", "actualizar"], ["tickers", "actualizar"]],
  cerrar: [["filas", "cierran"], ["sp_rentabilidad", "sp"], ["faltan_cierres", "sin_cierre"]],
};
/** Un valor más largo que esto baja a la segunda línea de la celda en vez de apretar el título. */
const LARGO = 24;

/** Contenido de la hoja de vista previa: lo que haría el proceso, sin guardar nada. */
export function VistaPrevia({ proceso, datos, hecho }: { proceso: string; datos: Datos; hecho: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const lista = (v: unknown[], nombres = false) => {
    if (!v.length) return t("admin_previa_ninguno");
    const cortos = nombres ? v.map(x => typeof x === "object" && x !== null ? (x as Datos).nombre : x) : v;
    const cuenta = t("admin_previa_recuento", { n: v.length });
    return v.length <= 8 && cortos.every(x => typeof x === "string" && x.length <= 40)
      ? `${cuenta} · ${cortos.join(", ")}` : cuenta;
  };
  const pares: [string, string | number][] = [];
  for (const [campo, etiqueta] of campos[proceso] ?? []) {
    const v = datos[campo];
    if (v == null || ((campo === "pregunta_pendientes" || campo === "pregunta_coste_estimado_usd") && typeof v !== "number")) continue;
    if (proceso === "diario" && campo === "tickers" && datos.n_tickers != null) continue;
    let valor: string | number;
    if (campo === "filas" && Array.isArray(v)) valor = v.length;
    else if (campo === "sp_rentabilidad" && (typeof v === "number" || typeof v === "string")) valor = porcentajeConSigno(v, locale);
    else if (Array.isArray(v)) valor = lista(v, campo === "crearia");
    else if (typeof v === "boolean") valor = t(v ? "admin_previa_si" : "admin_previa_no");
    else if (typeof v === "number" || typeof v === "string") valor = v;
    else continue;
    pares.push([etiqueta, valor]);
  }
  // Al ejecutar, el proceso devuelve estas colecciones en lugar de los recuentos de la vista previa.
  if (proceso === "formar" && hecho) {
    for (const [campo, etiqueta] of [["estrategias", "estrategias"], ["omitidas", "omitidas"]]) {
      if (Array.isArray(datos[campo]) && !pares.some(([e]) => e === etiqueta)) pares.push([etiqueta, (datos[campo] as unknown[]).length]);
    }
  }
  const motivos = Array.isArray(datos.motivos) ? datos.motivos.filter((m): m is string => typeof m === "string") : [];
  return (
    <>
      {hecho && <Grupo><Celda titulo={t("admin_liga_done")} /></Grupo>}
      {!hecho && datos.listo === false && (
        <Grupo>
          <Celda titulo={t("admin_previa_no_listo")} />
          {motivos.map((m, i) => <Celda key={i} titulo={m} />)}
        </Grupo>
      )}
      {pares.length > 0 && (
        <Grupo>
          {pares.map(([etiqueta, valor]) => {
            const largo = typeof valor === "string" && valor.length > LARGO;
            return <Celda key={etiqueta} titulo={t(`admin_previa_${etiqueta}`)} valor={largo ? undefined : valor} subtitulo={largo ? valor : undefined} />;
          })}
        </Grupo>
      )}
    </>
  );
}
