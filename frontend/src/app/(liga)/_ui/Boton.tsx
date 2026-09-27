"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

// `.btn` de la maqueta (DESIGN.md §6). DESIGN solo documenta secundario y `.pri`; «discreto»
// es nuevo (pedido como tercera variante) y reutiliza el tamaño de `.btn` en vez de `.link`
// (36 px), que no llega al objetivo táctil de 44 px de DESIGN.md §11.
export type VarianteBoton = "principal" | "secundario" | "discreto";
export type AnchoBoton = "auto" | "completo" | "flex";

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton;
  tamano?: "normal" | "pequeno";
  ancho?: AnchoBoton;
  icono?: ReactNode;
  children: ReactNode;
}

const CLASE_VARIANTE: Record<VarianteBoton, string> = {
  principal: "pri",
  secundario: "",
  discreto: "discreto",
};

const CLASE_ANCHO: Record<AnchoBoton, string> = {
  auto: "",
  completo: "wide",
  flex: "full",
};

export function Boton({
  variante = "secundario",
  tamano = "normal",
  ancho = "auto",
  icono,
  children,
  className,
  type = "button",
  ...resto
}: BotonProps) {
  const clases = [
    "btn",
    CLASE_VARIANTE[variante],
    tamano === "pequeno" ? "small" : "",
    CLASE_ANCHO[ancho],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={clases} {...resto}>
      {icono}
      {children}
    </button>
  );
}
