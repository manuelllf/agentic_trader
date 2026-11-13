"use client";

// Abrir la hoja de Cuenta desde fuera («⋯», avisos) sin cargar sus pantallas: el proveedor está en HojaCuenta.

import { createContext, useContext } from "react";
import type { Pantalla } from "./marco";

export const ContextoHojaCuenta = createContext<{ abrir: (p?: Pantalla) => void } | null>(null);

/** Fuera del proveedor devuelve null: quien abre la cuenta navega a /cuenta. */
export function useHojaCuenta() {
  return useContext(ContextoHojaCuenta);
}

/** Por debajo de la barra lateral (880 px) la cuenta va en hoja. */
export function cuentaEnHoja(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 879px)").matches;
}
