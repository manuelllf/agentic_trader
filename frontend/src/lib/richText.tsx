// Texto libre del LLM (tesis, informe, outlook...) con **negrita** y tablas markdown — las dos
// decoraciones que el modelo usa espontáneamente (el outlook macro trae una tabla de pronósticos
// a propósito, pedida en el prompt). Sin esto se pintaban literales: JSX escapa el texto, y no
// había NINGÚN sitio del frontend que interpretara markdown.
// ÚNICA fuente: no reimplementar esto por página. Devuelve bloques (incluye <table>), así que el
// contenedor que lo envuelve debe ser un <div>, nunca un <p> (un <table> dentro de <p> es HTML
// inválido y React lo renderiza mal).

import type { ReactNode } from "react";

function renderInline(text: string): ReactNode {
  const partes = text.split(/(\*\*[^*]+\*\*)/g);
  if (partes.length === 1) return text;
  return partes.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}

const FILA = /^\|(.+)\|\s*$/;
const SEPARADOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/;

function celdas(linea: string): string[] {
  return linea.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

export function richText(text: string): ReactNode {
  const lineas = text.split("\n");
  const bloques: ReactNode[] = [];
  let i = 0;
  let clave = 0;
  let parrafo: string[] = [];

  const cierraParrafo = () => {
    if (parrafo.length) {
      bloques.push(<p key={clave++} className="whitespace-pre-wrap">{renderInline(parrafo.join("\n"))}</p>);
      parrafo = [];
    }
  };

  while (i < lineas.length) {
    const linea = lineas[i];
    // La fila separadora (|---|---|) es opcional: el modelo no siempre la escribe pese a pedirle
    // una tabla, y exigirla dejaba la tabla entera como texto plano. Basta con 2+ filas seguidas.
    if (FILA.test(linea) && i + 1 < lineas.length && FILA.test(lineas[i + 1])) {
      cierraParrafo();
      const cabecera = celdas(linea);
      i += 1;
      if (SEPARADOR.test(lineas[i])) i += 1;
      const filas: string[][] = [];
      while (i < lineas.length && FILA.test(lineas[i])) {
        filas.push(celdas(lineas[i]));
        i += 1;
      }
      bloques.push(
        <div key={clave++} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-left text-[11px]">
            <thead>
              <tr>
                {cabecera.map((h, hi) => (
                  <th key={hi} className="border-b border-current/20 px-2 py-1 font-semibold">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, ri) => (
                <tr key={ri}>
                  {fila.map((c, ci) => (
                    <td key={ci} className="border-b border-current/10 px-2 py-1 align-top">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    parrafo.push(linea);
    i += 1;
  }
  cierraParrafo();
  return <>{bloques}</>;
}
