"use client";

import type { EvidenciaFormacion } from "@/lib/liga/evidencia";
import { porcentaje } from "@/lib/liga/format";
import { InfoTip } from "@/components/InfoTip";

const MOTIVOS = {
  excluida_manual: "La receta de esta formación excluye esta empresa expresamente.",
  metodologia_cambiada: "La metodología de esta formación cambió; no se atribuye la salida a una regla concreta.",
  regla_no_cumplida: "No supera todas las reglas en la foto de la nueva formación.",
  sigue_elegible_sin_entrar: "Sigue siendo elegible, pero no aparece en la nueva cartera. Esto no demuestra el motivo de su salida.",
  no_disponible: "Sin evidencia guardada suficiente para explicar su salida.",
};

export function EvidenciaCartera({ datos }: { datos: EvidenciaFormacion }) {
  const { formacion: f, posiciones, cambios } = datos;
  const comparables = posiciones.filter((p) => p.rendimiento.estado === "disponible"
    && p.rendimiento.diferencia_pp !== null);
  const superiores = comparables.filter((p) => p.rendimiento.diferencia_pp! > 0);
  const inferiores = comparables.filter((p) => p.rendimiento.diferencia_pp! < 0);
  return (
    <section className="ficha-analisis" aria-label="Evidencia de la cartera">
      <h3 className="sec-t">Cartera y evidencia</h3>
      <p className="fine">Jornada {f.jornada_numero} · base {f.desde} · {f.metodo === "mantenida"
        ? "posiciones mantenidas desde la cartera anterior" : "selección con la foto fijada para esta jornada"}.</p>
      {!f.receta_vigente && <p className="fine">La metodología guardada cambió después. Esta cartera conserva la receta con la que se formó.</p>}
      {f.estado_foto === "sin_datos" && <p className="fine">La foto de formación no está disponible para verificar las reglas. No se sustituye por datos actuales.</p>}
      {f.estado_reglas === "version_no_soportada" && <p className="fine">La versión histórica de estas reglas no puede reproducirse con el catálogo actual.</p>}

      {posiciones.map((p) => {
        const verificadas = p.reglas.filter((r) => r.cumple === true).length;
        const desconocidas = p.reglas.filter((r) => r.cumple === null).length;
        return <details key={p.ticker}>
          <summary>{p.ticker} · {Number(p.peso).toFixed(1).replace(".", ",")} %</summary>
          <p className="fine">{p.origen === "mantenida" ? "Posición mantenida." : "Posición seleccionada."}{" "}
            {p.reglas.length ? `${verificadas} de ${p.reglas.length} reglas verificadas${desconocidas ? `; ${desconocidas} sin evidencia suficiente` : ""}.`
              : f.estado_reglas === "disponible" ? "La receta no aplica filtros adicionales." : "Sin condiciones históricas verificables."}</p>
          {p.reglas.map((r) => <p className="fine" key={r.clave}>
            <b>{r.titulo}:</b> {r.cumple === true ? "cumple" : r.cumple === false ? "no cumple" : "sin dato verificable"}
            {r.motivo ? ` · ${r.motivo}` : ""}.
          </p>)}
          {p.rendimiento.estado === "disponible" && p.rendimiento.rentabilidad_pct !== null ? <>
            <p className="fine">Del {p.rendimiento.desde} al {p.rendimiento.hasta}: <b>{porcentaje(p.rendimiento.rentabilidad_pct)}</b>
              {" · "}S&amp;P 500 {porcentaje(p.rendimiento.sp500_pct!)}
              {" · "}{porcentaje(p.rendimiento.diferencia_pp!).replace(/%$/, "pp")}.</p>
            {p.rendimiento.incompleta && <p className="fine">Hay cierres intermedios ausentes; se comparan los extremos disponibles del periodo.</p>}
          </> : <p className="fine">Faltan cierres exactos comunes para comparar esta posición con el S&amp;P 500.</p>}
        </details>;
      })}

      {comparables.length > 0 && <div className="sec">
        <h3 className="sec-t">Comportamiento de las posiciones <InfoTip text="Retorno total de cada acción, con dividendos y splits. No es su contribución al resultado ni explica causalidad." /></h3>
        <p className="fine">{comparables.length} de {posiciones.length} posiciones comparables en el mismo periodo guardado.</p>
        <p className="fine">Por encima del S&amp;P 500: {superiores.length ? superiores.map((p) => p.ticker).join(", ") : "ninguna"}.</p>
        <p className="fine">Por debajo del S&amp;P 500: {inferiores.length ? inferiores.map((p) => p.ticker).join(", ") : "ninguna"}.</p>
      </div>}

      {cambios && <div className="sec">
        <h3 className="sec-t">Qué cambió en la última formación</h3>
        <p className="fine">Entradas: {cambios.entradas.length ? cambios.entradas.join(", ") : "ninguna"}.</p>
        {cambios.salidas.length ? cambios.salidas.map((s) => <details key={s.ticker}>
          <summary>Sale {s.ticker}</summary>
          <p className="fine">{MOTIVOS[s.causa]}</p>
          {s.causa === "regla_no_cumplida" && s.reglas.filter((r) => r.cumple === false).map((r) =>
            <p className="fine" key={r.clave}>{r.titulo}: {r.motivo ?? "no cumple la condición"}.</p>)}
        </details>) : <p className="fine">Sin salidas entre estas dos carteras formadas.</p>}
      </div>}

      <details>
        <summary>Metodología fijada para esta cartera</summary>
        {f.idea && <p className="fine">{f.idea}</p>}
        {f.reglas.map((r) => <p className="fine" key={r.clave}><b>{r.titulo}:</b> {r.detalle}.</p>)}
        {f.pesos && <p className="fine">Prioridades: {Object.entries(f.pesos).filter(([, v]) => v > 0).map(([k, v]) => {
          const nombres: Record<string, string> = { negocio: "negocio", precio: "valoración", deuda: "financiación", pronto: "catalizador", pregunta: "pregunta propia" };
          const total = Object.values(f.pesos!).reduce((s, peso) => s + peso, 0) || 1;
          return `${nombres[k] ?? k} ${Math.round(v * 100 / total)} %`;
        }).join(" · ")}.</p>}
        {f.pregunta && <p className="fine">Pregunta propia: {f.pregunta}</p>}
        {f.n_empresas !== null ? <p className="fine">Hasta {f.n_empresas} empresas · {f.reparto === "igual" ? "pesos iguales" : "pesos según puntuación"}
          {" · "}{f.max_por_sector ? `máximo ${f.max_por_sector} por sector` : "sin límite por sector"}.</p>
          : <p className="fine">La receta fijada para esta cartera no está disponible.</p>}
      </details>
    </section>
  );
}
