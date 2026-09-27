"use client";

import { Boton } from "./Boton";

// `.empty` de la maqueta (DESIGN.md §6): «Aún no juegas» + «Crear la mía», «Todavía no tienes
// ninguna»... Siempre explica qué pasa y ofrece la salida, nunca un hueco silencioso.
export interface VacioProps {
  titulo: string;
  texto: string;
  accion?: { texto: string; onClick: () => void };
}

export function Vacio({ titulo, texto, accion }: VacioProps) {
  return (
    <div className="empty">
      <h2>{titulo}</h2>
      <p>{texto}</p>
      {accion && (
        <Boton variante="principal" ancho="completo" onClick={accion.onClick}>
          {accion.texto}
        </Boton>
      )}
    </div>
  );
}
