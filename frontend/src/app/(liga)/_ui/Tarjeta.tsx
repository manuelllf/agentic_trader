import type { ReactNode } from "react";

// No hay una `.card` genérica en la maqueta: es el patrón `surface` + radio 14 que se repite
// en `.rulec`, `.pack`, `.code`... (DESIGN.md §4 y §6). `elevada` es la excepción que sí lleva
// sombra, la tarjeta que flota (`.sc`, radio 22, DESIGN.md §4 «Elevación»).
export interface TarjetaProps {
  children: ReactNode;
  elevada?: boolean;
  className?: string;
}

export function Tarjeta({ children, elevada = false, className }: TarjetaProps) {
  const clases = ["tarjeta", elevada ? "elevada" : "", className].filter(Boolean).join(" ");
  return <div className={clases}>{children}</div>;
}
