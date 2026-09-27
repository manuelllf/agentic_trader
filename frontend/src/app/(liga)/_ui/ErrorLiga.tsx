"use client";

import { Boton } from "./Boton";

// No está en la maqueta (solo enseña datos que siempre cargan bien): mismo lenguaje visual
// que `Vacio` (`.empty`), pero con `role="alert"` y la voz de error de DESIGN.md §10 — qué
// pasó y cómo se arregla, sin disculpas.
export interface ErrorLigaProps {
  titulo: string;
  mensaje: string;
  accion?: { texto: string; onClick: () => void };
}

export function ErrorLiga({ titulo, mensaje, accion }: ErrorLigaProps) {
  return (
    <div className="empty" role="alert">
      <h2>{titulo}</h2>
      <p>{mensaje}</p>
      {accion && (
        <Boton variante="secundario" ancho="completo" onClick={accion.onClick}>
          {accion.texto}
        </Boton>
      )}
    </div>
  );
}
