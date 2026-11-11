"use client";

// Portada sin sesión: la pantalla «Hoy» con la liga, el críptico y el boletín del día.
// Con sesión no enseña nada y redirige a /liga, sin parpadeo.

import type { EstadoCriptico } from "@/lib/criptico/estado";
import { useRedirigirSiHaySesion } from "../_sesion/SesionContext";
import { Hoy, type BoletinHoy } from "./Hoy";
import "./hoy.css";

export function Portada({ criptico, boletin = null }: { criptico: EstadoCriptico; boletin?: BoletinHoy }) {
  const sesion = useRedirigirSiHaySesion();
  if (sesion !== "fuera") return null;
  return <Hoy criptico={criptico} boletin={boletin} />;
}
