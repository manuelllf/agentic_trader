"use client";

// `.opt` de la maqueta (DESIGN.md §6): opción dentro de un `role="radiogroup"` (DESIGN.md §11).
// Se usa suelta, envuelta por quien la use en un `<div role="radiogroup" aria-label="…">`.
export interface OpcionRadioProps {
  marcada: boolean;
  titulo: string;
  ayuda: string;
  onClick: () => void;
  disabled?: boolean;
}

export function OpcionRadio({ marcada, titulo, ayuda, onClick, disabled }: OpcionRadioProps) {
  return (
    <button
      type="button"
      className="opt"
      role="radio"
      aria-checked={marcada}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="dot" aria-hidden="true" />
      <span>
        <b>{titulo}</b>
        <span>{ayuda}</span>
      </span>
    </button>
  );
}
