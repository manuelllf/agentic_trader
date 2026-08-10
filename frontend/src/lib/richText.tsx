// Texto libre del LLM (tesis, informe, outlook...) con **negrita** markdown — la única
// decoración que el modelo usa espontáneamente de vez en cuando (nada en los prompts se la pide
// ni se la prohíbe). Sin esto los asteriscos se pintaban literales: JSX escapa el texto, y no
// había NINGÚN sitio del frontend que interpretara markdown — por eso a veces "se veía bien"
// (el modelo no decoró esa respuesta) y a veces no (si decoró, quedaba el "**" tal cual).
// ÚNICA fuente: no reimplementar esto por página.

import type { ReactNode } from "react";

export function richText(text: string): ReactNode {
  const partes = text.split(/(\*\*[^*]+\*\*)/g);
  if (partes.length === 1) return text;
  return partes.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}
