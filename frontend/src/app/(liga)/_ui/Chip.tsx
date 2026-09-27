"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

// `.chip` de la maqueta (DESIGN.md §6): el plan, los créditos... Como `<span>` si es solo
// informativo, o como `<button>` si abre algo (los créditos abren la hoja de créditos).
export interface ChipProps {
  children: ReactNode;
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
  className?: string;
}

export function Chip({ children, onClick, className }: ChipProps) {
  const clases = ["chip", className].filter(Boolean).join(" ");
  if (onClick) {
    return (
      <button type="button" className={clases} onClick={onClick}>
        {children}
      </button>
    );
  }
  return <span className={clases}>{children}</span>;
}
